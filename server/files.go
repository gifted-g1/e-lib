package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var allowedExt = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
	".mov": "video/quicktime", ".mkv": "video/x-matroska", ".pdf": "application/pdf",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
}

var fileKeyRe = regexp.MustCompile(`^[a-f0-9]{32}\.[a-z0-9]{2,5}$`)

// fileSig is deterministic so a file's link never changes (laptops re-download when the link changes).
func (a *App) fileSig(key string) string {
	m := hmac.New(sha256.New, a.cfg.Secret)
	m.Write([]byte("file:" + key))
	return hex.EncodeToString(m.Sum(nil))[:40]
}

func (a *App) publicBase(r *http.Request) string {
	if a.cfg.PublicURL != "" {
		return a.cfg.PublicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p == "https" || p == "http" {
		scheme = p
	}
	host := r.Host
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		host = h
	}
	return scheme + "://" + host
}

func (a *App) fileURL(r *http.Request, key string) string {
	if key == "" {
		return ""
	}
	return a.publicBase(r) + "/files/" + key + "?sig=" + a.fileSig(key)
}

func (a *App) filePath(key string) string { return filepath.Join(a.filesDir, key) }

func (a *App) removeFile(key string) {
	if !fileKeyRe.MatchString(key) {
		return
	}
	os.Remove(a.filePath(key))
	a.db.Exec(`DELETE FROM files WHERE key = ?`, key)
}

// removeFileIfUnused deletes a file once no content item refers to it any more.
func (a *App) removeFileIfUnused(key string) {
	if key == "" {
		return
	}
	var n int
	a.db.QueryRow(`SELECT COUNT(*) FROM content WHERE file_key = ? OR thumb_file_key = ?`, key, key).Scan(&n)
	if n == 0 {
		a.removeFile(key)
	}
}

// POST /api/v1/files  (multipart field "file") -> {key, name, size}
func (a *App) uploadFile(w http.ResponseWriter, r *http.Request, accountID int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxUploadBytes+1<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		return badRequest("Expected a file upload.")
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return badRequest("No file in the upload.")
		}
		if err != nil {
			return badRequest("Upload was interrupted.")
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}
		name := filepath.Base(part.FileName())
		ext := strings.ToLower(filepath.Ext(name))
		if _, ok := allowedExt[ext]; !ok {
			return badRequest("This file type is not supported. Use MP4/WebM videos, PDFs or PNG/JPG/WebP/GIF pictures.")
		}
		key := randomHex(16) + ext
		tmp := a.filePath(key) + ".part"
		f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		size, copyErr := io.Copy(f, io.LimitReader(part, a.cfg.MaxUploadBytes+1))
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil {
			os.Remove(tmp)
			return badRequest("Upload was interrupted.")
		}
		if size > a.cfg.MaxUploadBytes {
			os.Remove(tmp)
			return &apiError{http.StatusRequestEntityTooLarge, "File is too large."}
		}
		if size == 0 {
			os.Remove(tmp)
			return badRequest("The file is empty.")
		}
		if err := os.Rename(tmp, a.filePath(key)); err != nil {
			os.Remove(tmp)
			return err
		}
		if _, err := a.db.Exec(`INSERT INTO files (key, account_id, name, size, created_at) VALUES (?, ?, ?, ?, ?)`,
			key, accountID, name, size, time.Now().Unix()); err != nil {
			os.Remove(a.filePath(key))
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": key, "name": name, "size": size})
		return nil
	}
}

// GET /files/{key}?sig=...  (range requests supported, for video seeking and resumable downloads)
func (a *App) serveFile(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	sig := r.URL.Query().Get("sig")
	if !fileKeyRe.MatchString(key) || !hmac.Equal([]byte(sig), []byte(a.fileSig(key))) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(a.filePath(key))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", allowedExt[filepath.Ext(key)])
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, key, st.ModTime(), f)
}

// fileOwned reports whether an uploaded file belongs to the account.
func (a *App) fileOwned(accountID int64, key string) bool {
	if key == "" {
		return true
	}
	var n int
	a.db.QueryRow(`SELECT COUNT(*) FROM files WHERE key = ? AND account_id = ?`, key, accountID).Scan(&n)
	return n == 1
}

func (a *App) fileInfo(key string) (name string, size int64) {
	a.db.QueryRow(`SELECT name, size FROM files WHERE key = ?`, key).Scan(&name, &size)
	return
}
