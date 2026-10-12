package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	hmRe     = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	domainRe = regexp.MustCompile(`^[a-z0-9.-]+$`)
)

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

func (a *App) ownDevice(accountID, id int64) error {
	var n int
	a.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE id = ? AND account_id = ?`, id, accountID).Scan(&n)
	if n == 0 {
		return notFound()
	}
	return nil
}

func (a *App) listDevices(w http.ResponseWriter, r *http.Request, accountID int64) error {
	devices, err := queryMaps(a.db, `SELECT d.id, d.name, d.hardware_id, d.last_seen_at, d.app_version,
		d.daily_limit_minutes, d.schedule_enabled, d.schedule_start, d.schedule_end, d.created_at,
		(SELECT COUNT(*) FROM requests q WHERE q.device_id = d.id AND q.status = 'pending') AS pending_requests
		FROM devices d WHERE d.account_id = ? ORDER BY d.name COLLATE NOCASE`, accountID)
	if err != nil {
		return err
	}
	for _, d := range devices {
		// Each child's usage on the most recent day the laptop reported.
		children, err := queryMaps(a.db, `SELECT c.local_id, c.name, c.age, c.avatar,
			(SELECT u.day FROM device_usage u WHERE u.device_id = c.device_id AND u.child_local_id = c.local_id ORDER BY u.day DESC LIMIT 1) AS usage_day,
			(SELECT u.seconds FROM device_usage u WHERE u.device_id = c.device_id AND u.child_local_id = c.local_id ORDER BY u.day DESC LIMIT 1) AS usage_seconds
			FROM device_children c WHERE c.device_id = ? ORDER BY c.name COLLATE NOCASE`, d["id"])
		if err != nil {
			return err
		}
		d["children"] = children
	}
	writeJSON(w, http.StatusOK, devices)
	return nil
}

func (a *App) createDevice(w http.ResponseWriter, r *http.Request, accountID int64) error {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		return badRequest("Please give the laptop a name (e.g. \"Ada's laptop\").")
	}
	token := randomToken(24)
	res, err := a.db.Exec(`INSERT INTO devices (account_id, name, token_hash) VALUES (?, ?, ?)`, accountID, name, hashToken(token))
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "token": token})
	return nil
}

func (a *App) updateDevice(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := a.ownDevice(accountID, id); err != nil {
		return err
	}
	var body struct {
		Name              *string `json:"name"`
		DailyLimitMinutes *int    `json:"daily_limit_minutes"`
		ScheduleEnabled   *bool   `json:"schedule_enabled"`
		ScheduleStart     *string `json:"schedule_start"`
		ScheduleEnd       *string `json:"schedule_end"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	if body.Name != nil {
		n := strings.TrimSpace(*body.Name)
		if n == "" || len(n) > 100 {
			return badRequest("Please enter a name.")
		}
		a.db.Exec(`UPDATE devices SET name = ? WHERE id = ?`, n, id)
	}
	if body.DailyLimitMinutes != nil {
		if *body.DailyLimitMinutes < 0 || *body.DailyLimitMinutes > 1440 {
			return badRequest("Daily limit must be between 0 and 1440 minutes.")
		}
		a.db.Exec(`UPDATE devices SET daily_limit_minutes = ? WHERE id = ?`, *body.DailyLimitMinutes, id)
	}
	if body.ScheduleEnabled != nil {
		a.db.Exec(`UPDATE devices SET schedule_enabled = ? WHERE id = ?`, boolInt(*body.ScheduleEnabled), id)
	}
	for col, v := range map[string]*string{"schedule_start": body.ScheduleStart, "schedule_end": body.ScheduleEnd} {
		if v == nil {
			continue
		}
		if !hmRe.MatchString(*v) {
			return badRequest("Times must look like 08:00.")
		}
		a.db.Exec(`UPDATE devices SET `+col+` = ? WHERE id = ?`, *v, id)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

func (a *App) deleteDevice(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM devices WHERE id = ? AND account_id = ?`, id, accountID); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// rotateDeviceToken issues a new token; the old one stops working immediately.
func (a *App) rotateDeviceToken(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := a.ownDevice(accountID, id); err != nil {
		return err
	}
	token := randomToken(24)
	if _, err := a.db.Exec(`UPDATE devices SET token_hash = ?, hardware_id = NULL WHERE id = ?`, hashToken(token), id); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "token": token})
	return nil
}

func (a *App) grantTime(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := a.ownDevice(accountID, id); err != nil {
		return err
	}
	var body struct {
		Minutes int `json:"minutes"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	if body.Minutes < 1 || body.Minutes > 600 {
		return badRequest("Minutes must be between 1 and 600.")
	}
	if _, err := a.db.Exec(`INSERT INTO grants (device_id, minutes, created_at) VALUES (?, ?, ?)`, id, body.Minutes, time.Now().Unix()); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

func (a *App) listCategories(w http.ResponseWriter, r *http.Request, accountID int64) error {
	rows, err := queryMaps(a.db, `SELECT id, name, icon, sort_order FROM categories WHERE account_id = ? ORDER BY sort_order, id`, accountID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, rows)
	return nil
}

func (a *App) saveCategory(w http.ResponseWriter, r *http.Request, accountID int64) error {
	var body struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		return badRequest("Please enter a category name.")
	}
	icon := strings.TrimSpace(body.Icon)
	if r.PathValue("id") != "" {
		id, err := pathID(r, "id")
		if err != nil {
			return err
		}
		res, err := a.db.Exec(`UPDATE categories SET name = ?, icon = ? WHERE id = ? AND account_id = ?`, name, nullStr(icon), id, accountID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound()
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id})
		return nil
	}
	res, err := a.db.Exec(`INSERT INTO categories (account_id, name, icon, sort_order)
		VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories WHERE account_id = ?))`,
		accountID, name, nullStr(icon), accountID)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
	return nil
}

func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM categories WHERE id = ? AND account_id = ?`, id, accountID); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

func (a *App) reorder(w http.ResponseWriter, r *http.Request, accountID int64, table string) error {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := readJSON(w, r, &body, 1<<20); err != nil {
		return err
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range body.IDs {
		if _, err := tx.Exec(`UPDATE `+table+` SET sort_order = ? WHERE id = ? AND account_id = ?`, i, id, accountID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

func (a *App) reorderCategories(w http.ResponseWriter, r *http.Request, accountID int64) error {
	return a.reorder(w, r, accountID, "categories")
}

func (a *App) reorderContent(w http.ResponseWriter, r *http.Request, accountID int64) error {
	return a.reorder(w, r, accountID, "content")
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

func (a *App) listContent(w http.ResponseWriter, r *http.Request, accountID int64) error {
	rows, err := queryMaps(a.db, `SELECT c.*, cat.name AS category_name, cat.icon AS category_icon
		FROM content c LEFT JOIN categories cat ON cat.id = c.category_id
		WHERE c.account_id = ? ORDER BY COALESCE(cat.sort_order, 9999), c.category_id, c.sort_order, c.id`, accountID)
	if err != nil {
		return err
	}
	for _, c := range rows {
		delete(c, "account_id")
		if k, _ := c["file_key"].(string); k != "" {
			name, size := a.fileInfo(k)
			c["file_name"], c["file_size"], c["file_url"] = name, size, a.fileURL(r, k)
		}
		if k, _ := c["thumb_file_key"].(string); k != "" {
			c["thumb_url"] = a.fileURL(r, k)
		} else {
			c["thumb_url"] = c["thumbnail_url"]
		}
	}
	writeJSON(w, http.StatusOK, rows)
	return nil
}

type contentInput struct {
	Title          string `json:"title"`
	Type           string `json:"type"`
	CategoryID     *int64 `json:"category_id"`
	SourceURL      string `json:"source_url"`
	FileKey        string `json:"file_key"`
	ThumbnailURL   string `json:"thumbnail_url"`
	ThumbFileKey   string `json:"thumb_file_key"`
	Description    string `json:"description"`
	AllowedDomains string `json:"allowed_domains"`
	IsApproved     *bool  `json:"is_approved"`
}

var videoExt = map[string]bool{".mp4": true, ".m4v": true, ".webm": true, ".ogv": true, ".mov": true, ".mkv": true}
var imageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true}

func normalizeDomains(s string) string {
	seen := map[string]bool{}
	var out []string
	for _, raw := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '\n' || r == ' ' || r == '\t' || r == '\r' }) {
		h := raw
		if strings.Contains(raw, "://") {
			h = hostOf(raw)
		} else {
			h = strings.ToLower(strings.Split(raw, "/")[0])
		}
		h = strings.TrimPrefix(h, "*.")
		if h != "" && !seen[h] && domainRe.MatchString(h) {
			seen[h] = true
			out = append(out, h)
		}
	}
	return strings.Join(out, "\n")
}

func (a *App) validateContent(accountID int64, in *contentInput) error {
	in.Title = strings.TrimSpace(in.Title)
	in.SourceURL = strings.TrimSpace(in.SourceURL)
	in.ThumbnailURL = strings.TrimSpace(in.ThumbnailURL)
	in.Description = strings.TrimSpace(in.Description)
	if in.Title == "" || len(in.Title) > 200 {
		return badRequest("Please enter a title.")
	}
	if len(in.Description) > 1000 {
		return badRequest("Description is too long.")
	}
	switch in.Type {
	case "site":
		in.FileKey = ""
		if !isHTTPURL(in.SourceURL) {
			return badRequest("Please enter the website address (starting with https://).")
		}
		in.AllowedDomains = normalizeDomains(in.AllowedDomains)
	case "video", "pdf":
		in.AllowedDomains = ""
		if in.FileKey != "" {
			in.SourceURL = ""
			ext := strings.ToLower(filepath.Ext(in.FileKey))
			if (in.Type == "pdf" && ext != ".pdf") || (in.Type == "video" && !videoExt[ext]) {
				return badRequest("The uploaded file does not match the content type.")
			}
			if !a.fileOwned(accountID, in.FileKey) {
				return badRequest("Unknown file. Please upload it again.")
			}
		} else if !isHTTPURL(in.SourceURL) {
			return badRequest("Upload a file or enter a link starting with https://.")
		}
	default:
		return badRequest("Choose a content type.")
	}
	if in.ThumbnailURL != "" && !isHTTPURL(in.ThumbnailURL) {
		return badRequest("Picture links must start with https://.")
	}
	if in.ThumbFileKey != "" {
		if !imageExt[strings.ToLower(filepath.Ext(in.ThumbFileKey))] || !a.fileOwned(accountID, in.ThumbFileKey) {
			return badRequest("Unknown picture. Please upload it again.")
		}
		in.ThumbnailURL = ""
	}
	if in.CategoryID != nil {
		var n int
		a.db.QueryRow(`SELECT COUNT(*) FROM categories WHERE id = ? AND account_id = ?`, *in.CategoryID, accountID).Scan(&n)
		if n == 0 {
			return badRequest("Unknown category.")
		}
	}
	return nil
}

func (a *App) saveContent(w http.ResponseWriter, r *http.Request, accountID int64) error {
	var in contentInput
	if err := readJSON(w, r, &in, 1<<16); err != nil {
		return err
	}
	if err := a.validateContent(accountID, &in); err != nil {
		return err
	}
	approved := in.IsApproved == nil || *in.IsApproved

	if r.PathValue("id") == "" {
		res, err := a.db.Exec(`INSERT INTO content (account_id, category_id, title, type, source_url, file_key, thumbnail_url,
			thumb_file_key, description, allowed_domains, is_approved, sort_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM content WHERE account_id = ? AND category_id IS ?))`,
			accountID, in.CategoryID, in.Title, in.Type, nullStr(in.SourceURL), nullStr(in.FileKey), nullStr(in.ThumbnailURL),
			nullStr(in.ThumbFileKey), nullStr(in.Description), nullStr(in.AllowedDomains), boolInt(approved), accountID, in.CategoryID)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		writeJSON(w, http.StatusOK, map[string]any{"id": id})
		return nil
	}

	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var oldFile, oldThumb sql.NullString
	err = a.db.QueryRow(`SELECT file_key, thumb_file_key FROM content WHERE id = ? AND account_id = ?`, id, accountID).Scan(&oldFile, &oldThumb)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound()
	} else if err != nil {
		return err
	}
	_, err = a.db.Exec(`UPDATE content SET category_id = ?, title = ?, type = ?, source_url = ?, file_key = ?, thumbnail_url = ?,
		thumb_file_key = ?, description = ?, allowed_domains = ?, is_approved = ?,
		updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND account_id = ?`,
		in.CategoryID, in.Title, in.Type, nullStr(in.SourceURL), nullStr(in.FileKey), nullStr(in.ThumbnailURL),
		nullStr(in.ThumbFileKey), nullStr(in.Description), nullStr(in.AllowedDomains), boolInt(approved), id, accountID)
	if err != nil {
		return err
	}
	if oldFile.String != in.FileKey {
		a.removeFileIfUnused(oldFile.String)
	}
	if oldThumb.String != in.ThumbFileKey {
		a.removeFileIfUnused(oldThumb.String)
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
	return nil
}

func (a *App) deleteContent(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var fileKey, thumbKey sql.NullString
	err = a.db.QueryRow(`SELECT file_key, thumb_file_key FROM content WHERE id = ? AND account_id = ?`, id, accountID).Scan(&fileKey, &thumbKey)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound()
	} else if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM content WHERE id = ?`, id); err != nil {
		return err
	}
	a.removeFileIfUnused(fileKey.String)
	a.removeFileIfUnused(thumbKey.String)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// ---------------------------------------------------------------------------
// Requests + activity
// ---------------------------------------------------------------------------

func (a *App) listRequests(w http.ResponseWriter, r *http.Request, accountID int64) error {
	status := r.URL.Query().Get("status")
	where := ""
	args := []any{accountID}
	if status == "pending" || status == "approved" || status == "denied" {
		where = " AND q.status = ?"
		args = append(args, status)
	}
	rows, err := queryMaps(a.db, `SELECT q.id, q.device_id, d.name AS device_name, ch.name AS child_name, q.content_title,
		q.content_url, q.content_remote_id, q.status, q.created_at, q.resolved_at
		FROM requests q JOIN devices d ON d.id = q.device_id
		LEFT JOIN device_children ch ON ch.device_id = q.device_id AND ch.local_id = q.child_local_id
		WHERE d.account_id = ?`+where+` ORDER BY (q.status = 'pending') DESC, q.created_at DESC LIMIT 500`, args...)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, rows)
	return nil
}

// resolveRequest records the decision and applies it to the library, so the next sync carries it.
func (a *App) resolveRequest(w http.ResponseWriter, r *http.Request, accountID int64) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := readJSON(w, r, &body, 1<<16); err != nil {
		return err
	}
	if body.Status != "approved" && body.Status != "denied" {
		return badRequest("Status must be approved or denied.")
	}
	var status string
	var remoteID, url sql.NullString
	err = a.db.QueryRow(`SELECT q.status, q.content_remote_id, q.content_url FROM requests q JOIN devices d ON d.id = q.device_id
		WHERE q.id = ? AND d.account_id = ?`, id, accountID).Scan(&status, &remoteID, &url)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound()
	} else if err != nil {
		return err
	}
	if status != "pending" {
		return badRequest("This request was already answered.")
	}
	if _, err := a.db.Exec(`UPDATE requests SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`, body.Status, id); err != nil {
		return err
	}
	effect := ""
	if body.Status == "approved" {
		effect = a.applyApproval(accountID, remoteID.String, url.String)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "effect": effect})
	return nil
}

func (a *App) applyApproval(accountID int64, remoteID, url string) string {
	host := hostOf(url)
	if contentID, err := strconv.ParseInt(remoteID, 10, 64); err == nil {
		var title, typ string
		var domains sql.NullString
		err := a.db.QueryRow(`SELECT title, type, allowed_domains FROM content WHERE id = ? AND account_id = ?`, contentID, accountID).
			Scan(&title, &typ, &domains)
		if err == nil {
			if host != "" && typ == "site" {
				a.db.Exec(`UPDATE content SET allowed_domains = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
					normalizeDomains(domains.String+"\n"+host), contentID)
				return fmt.Sprintf("%s can now be opened from \"%s\".", host, title)
			}
			a.db.Exec(`UPDATE content SET is_approved = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`, contentID)
			return fmt.Sprintf("\"%s\" is now unlocked.", title)
		}
	}
	if remoteID == "" && host != "" {
		var catID sql.NullInt64
		a.db.QueryRow(`SELECT id FROM categories WHERE account_id = ? AND (name LIKE '%site%' OR name LIKE '%web%') ORDER BY sort_order LIMIT 1`, accountID).Scan(&catID)
		a.db.Exec(`INSERT INTO content (account_id, category_id, title, type, source_url, is_approved) VALUES (?, ?, ?, 'site', ?, 1)`,
			accountID, catID, host, url)
		return fmt.Sprintf("Added %s as a new website.", host)
	}
	return "Approved. The laptop will apply it on its next sync."
}

func (a *App) listActivity(w http.ResponseWriter, r *http.Request, accountID int64) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 2000 {
		limit = 300
	}
	where := ""
	args := []any{accountID}
	if dev, err := strconv.ParseInt(r.URL.Query().Get("device_id"), 10, 64); err == nil {
		where = " AND a.device_id = ?"
		args = append(args, dev)
	}
	args = append(args, limit)
	rows, err := queryMaps(a.db, `SELECT a.id, a.device_id, d.name AS device_name, ch.name AS child_name, a.content_title,
		a.action, a.detail, a.timestamp
		FROM activity a JOIN devices d ON d.id = a.device_id
		LEFT JOIN device_children ch ON ch.device_id = a.device_id AND ch.local_id = a.child_local_id
		WHERE d.account_id = ?`+where+` ORDER BY a.timestamp DESC, a.id DESC LIMIT ?`, args...)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, rows)
	return nil
}
