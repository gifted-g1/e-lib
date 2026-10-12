// Command server is the Child-Safe E-Library sync server: parents manage content and child laptops
// from the parent desktop app, and child laptops pull their library and push requests/activity.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Config struct {
	Addr           string
	DataDir        string
	PublicURL      string // e.g. https://library.example.org (used in file links sent to laptops)
	Secret         []byte // signs file download links
	AllowSignup    bool   // allow new parent accounts after the first one
	MaxUploadBytes int64
}

type App struct {
	cfg      Config
	db       *sql.DB
	filesDir string
	limiter  *rateLimiter
}

func loadConfig() (Config, error) {
	cfg := Config{
		Addr:        envOr("ELIB_ADDR", ":8080"),
		DataDir:     envOr("ELIB_DATA_DIR", "./data"),
		PublicURL:   strings.TrimRight(os.Getenv("ELIB_PUBLIC_URL"), "/"),
		AllowSignup: os.Getenv("ELIB_ALLOW_SIGNUP") == "1",
	}
	mb, err := strconv.ParseInt(envOr("ELIB_MAX_UPLOAD_MB", "2048"), 10, 64)
	if err != nil || mb <= 0 {
		return cfg, errors.New("ELIB_MAX_UPLOAD_MB must be a positive number")
	}
	cfg.MaxUploadBytes = mb << 20
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return cfg, err
	}
	secret, err := loadSecret(cfg.DataDir)
	if err != nil {
		return cfg, err
	}
	cfg.Secret = secret
	return cfg, nil
}

// loadSecret uses ELIB_SECRET, or a random key persisted in the data dir on first start.
func loadSecret(dataDir string) ([]byte, error) {
	if s := os.Getenv("ELIB_SECRET"); s != "" {
		if len(s) < 32 {
			return nil, errors.New("ELIB_SECRET must be at least 32 characters")
		}
		return []byte(s), nil
	}
	path := filepath.Join(dataDir, "secret.key")
	if b, err := os.ReadFile(path); err == nil && len(b) >= 32 {
		return b, nil
	}
	s := []byte(randomHex(32))
	if err := os.WriteFile(path, s, 0o600); err != nil {
		return nil, fmt.Errorf("write secret: %w", err)
	}
	return s, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func NewApp(cfg Config) (*App, error) {
	filesDir := filepath.Join(cfg.DataDir, "files")
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(cfg.DataDir, "elibrary-server.db"))
	if err != nil {
		return nil, err
	}
	return &App{cfg: cfg, db: db, filesDir: filesDir, limiter: newRateLimiter(10, 15*time.Minute)}, nil
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	// --- parent accounts ---
	mux.HandleFunc("GET /api/v1/auth/status", a.authStatus)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.Handle("POST /api/v1/auth/logout", a.parent(a.logout))
	mux.Handle("POST /api/v1/auth/password", a.parent(a.changePassword))
	mux.Handle("GET /api/v1/me", a.parent(a.me))

	// --- parent: devices (child laptops) ---
	mux.Handle("GET /api/v1/devices", a.parent(a.listDevices))
	mux.Handle("POST /api/v1/devices", a.parent(a.createDevice))
	mux.Handle("PATCH /api/v1/devices/{id}", a.parent(a.updateDevice))
	mux.Handle("DELETE /api/v1/devices/{id}", a.parent(a.deleteDevice))
	mux.Handle("POST /api/v1/devices/{id}/token", a.parent(a.rotateDeviceToken))
	mux.Handle("POST /api/v1/devices/{id}/grants", a.parent(a.grantTime))

	// --- parent: library ---
	mux.Handle("GET /api/v1/categories", a.parent(a.listCategories))
	mux.Handle("POST /api/v1/categories", a.parent(a.saveCategory))
	mux.Handle("PATCH /api/v1/categories/{id}", a.parent(a.saveCategory))
	mux.Handle("DELETE /api/v1/categories/{id}", a.parent(a.deleteCategory))
	mux.Handle("POST /api/v1/categories/reorder", a.parent(a.reorderCategories))
	mux.Handle("GET /api/v1/content", a.parent(a.listContent))
	mux.Handle("POST /api/v1/content", a.parent(a.saveContent))
	mux.Handle("PATCH /api/v1/content/{id}", a.parent(a.saveContent))
	mux.Handle("DELETE /api/v1/content/{id}", a.parent(a.deleteContent))
	mux.Handle("POST /api/v1/content/reorder", a.parent(a.reorderContent))
	mux.Handle("POST /api/v1/files", a.parent(a.uploadFile))

	// --- parent: requests + activity ---
	mux.Handle("GET /api/v1/requests", a.parent(a.listRequests))
	mux.Handle("POST /api/v1/requests/{id}/resolve", a.parent(a.resolveRequest))
	mux.Handle("GET /api/v1/activity", a.parent(a.listActivity))

	// --- child laptops (authenticated by device token; {hw} is the laptop's own id) ---
	mux.Handle("GET /api/v1/devices/{hw}/library", a.device(a.library))
	mux.Handle("POST /api/v1/devices/{hw}/events", a.device(a.events))

	// --- signed file downloads ---
	mux.HandleFunc("GET /files/{key}", a.serveFile)

	return logRequests(securityHeaders(mux))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}

// janitor removes expired sessions and uploads that were never attached to content.
func (a *App) janitor(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		a.cleanup()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (a *App) cleanup() {
	now := time.Now().Unix()
	if _, err := a.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now); err != nil {
		log.Printf("cleanup sessions: %v", err)
	}
	a.db.Exec(`DELETE FROM grants WHERE created_at < ?`, now-7*24*3600)
	rows, err := a.db.Query(`SELECT key FROM files WHERE created_at < ? AND key NOT IN
		(SELECT file_key FROM content WHERE file_key IS NOT NULL UNION SELECT thumb_file_key FROM content WHERE thumb_file_key IS NOT NULL)`,
		now-24*3600)
	if err != nil {
		log.Printf("cleanup files: %v", err)
		return
	}
	var keys []string
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			keys = append(keys, k)
		}
	}
	rows.Close()
	for _, k := range keys {
		a.removeFile(k)
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	app, err := NewApp(cfg)
	if err != nil {
		log.Fatalf("start: %v", err)
	}
	defer app.db.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go app.janitor(ctx)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           app.Routes(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("Child-Safe E-Library server listening on %s (data: %s)", cfg.Addr, cfg.DataDir)
	if cfg.PublicURL == "" {
		log.Printf("ELIB_PUBLIC_URL is not set; file links will use the request's host")
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
