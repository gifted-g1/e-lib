package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	sessionTTL        = 30 * 24 * time.Hour
	minPasswordLength = 8
)

type parentHandler func(w http.ResponseWriter, r *http.Request, accountID int64) error
type deviceHandler func(w http.ResponseWriter, r *http.Request, dev *Device) error

type Device struct {
	ID        int64
	AccountID int64
	Name      string
}

// parent authenticates a parent session token.
func (a *App) parent(h parentHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		var accountID int64
		err := a.db.QueryRow(`SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?`,
			hashToken(token), time.Now().Unix()).Scan(&accountID)
		if token == "" || err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please sign in again."})
			return
		}
		if err := h(w, r, accountID); err != nil {
			writeError(w, err)
		}
	})
}

// device authenticates a child laptop by its device token.
func (a *App) device(h deviceHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		dev := &Device{}
		err := a.db.QueryRow(`SELECT id, account_id, name FROM devices WHERE token_hash = ?`, hashToken(token)).
			Scan(&dev.ID, &dev.AccountID, &dev.Name)
		if token == "" || err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unknown device token."})
			return
		}
		// Remember which laptop uses this token (its own id is in the URL).
		a.db.Exec(`UPDATE devices SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
			hardware_id = COALESCE(hardware_id, ?) WHERE id = ?`, nullStr(r.PathValue("hw")), dev.ID)
		if err := h(w, r, dev); err != nil {
			writeError(w, err)
		}
	})
}

func (a *App) accountCount() (int, error) {
	var n int
	err := a.db.QueryRow(`SELECT COUNT(*) FROM accounts`).Scan(&n)
	return n, err
}

func (a *App) authStatus(w http.ResponseWriter, r *http.Request) {
	n, err := a.accountCount()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signup_open": n == 0 || a.cfg.AllowSignup, "has_accounts": n > 0})
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow("register:" + clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many attempts. Try again later."})
		return
	}
	var c credentials
	if err := readJSON(w, r, &c, 1<<16); err != nil {
		writeError(w, err)
		return
	}
	c.Email = strings.TrimSpace(c.Email)
	if !strings.Contains(c.Email, "@") || len(c.Email) > 200 {
		writeError(w, badRequest("Please enter a valid e-mail address."))
		return
	}
	if len(c.Password) < minPasswordLength || len(c.Password) > 72 {
		writeError(w, badRequest("Password must be 8 to 72 characters."))
		return
	}
	n, err := a.accountCount()
	if err != nil {
		writeError(w, err)
		return
	}
	if n > 0 && !a.cfg.AllowSignup {
		writeError(w, &apiError{http.StatusForbidden, "New accounts are disabled on this server."})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, err)
		return
	}
	res, err := a.db.Exec(`INSERT INTO accounts (email, password_hash) VALUES (?, ?)`, c.Email, string(hash))
	if err != nil {
		writeError(w, badRequest("An account with this e-mail already exists."))
		return
	}
	accountID, _ := res.LastInsertId()
	a.seedAccount(accountID)
	a.issueSession(w, accountID, c.Email)
}

func (a *App) seedAccount(accountID int64) {
	for i, c := range [][2]string{{"Tutorial Videos", "🎬"}, {"PDFs", "📚"}, {"External Sites", "🌍"}} {
		a.db.Exec(`INSERT INTO categories (account_id, name, icon, sort_order) VALUES (?, ?, ?, ?)`, accountID, c[0], c[1], i)
	}
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow("login:" + clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many attempts. Try again in 15 minutes."})
		return
	}
	var c credentials
	if err := readJSON(w, r, &c, 1<<16); err != nil {
		writeError(w, err)
		return
	}
	var id int64
	var hash string
	err := a.db.QueryRow(`SELECT id, password_hash FROM accounts WHERE email = ?`, strings.TrimSpace(c.Email)).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && bcrypt.CompareHashAndPassword([]byte(hash), []byte(c.Password)) != nil) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "E-mail or password is not right."})
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	a.issueSession(w, id, strings.TrimSpace(c.Email))
}

func (a *App) issueSession(w http.ResponseWriter, accountID int64, email string) {
	token := randomToken(32)
	_, err := a.db.Exec(`INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)`,
		hashToken(token), accountID, time.Now().Add(sessionTTL).Unix())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "email": email})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request, _ int64) error {
	_, err := a.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(bearerToken(r)))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

func (a *App) me(w http.ResponseWriter, r *http.Request, accountID int64) error {
	var email, created string
	if err := a.db.QueryRow(`SELECT email, created_at FROM accounts WHERE id = ?`, accountID).Scan(&email, &created); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": email, "created_at": created})
	return nil
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request, accountID int64) error {
	var body struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	var hash string
	if err := a.db.QueryRow(`SELECT password_hash FROM accounts WHERE id = ?`, accountID).Scan(&hash); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Current)) != nil {
		return badRequest("Current password is not right.")
	}
	if len(body.Next) < minPasswordLength || len(body.Next) > 72 {
		return badRequest("New password must be 8 to 72 characters.")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(body.Next), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`UPDATE accounts SET password_hash = ? WHERE id = ?`, string(newHash), accountID); err != nil {
		return err
	}
	// Sign out every other session.
	a.db.Exec(`DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?`, accountID, hashToken(bearerToken(r)))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// rateLimiter allows `limit` attempts per key per window (in memory; fine for a single server).
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, hits: map[string][]time.Time{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	recent := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.limit {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	if len(l.hits) > 10000 { // bound memory
		l.hits = map[string][]time.Time{}
	}
	return true
}
