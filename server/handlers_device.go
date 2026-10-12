package main

import (
	"net/http"
	"strconv"
	"time"
)

// GET /api/v1/devices/{hw}/library -- the full library for one laptop.
// "full": true tells the laptop to remove server items that are no longer listed.
func (a *App) library(w http.ResponseWriter, r *http.Request, dev *Device) error {
	cats, err := queryMaps(a.db, `SELECT id, name, icon, sort_order FROM categories WHERE account_id = ? ORDER BY sort_order, id`, dev.AccountID)
	if err != nil {
		return err
	}
	categories := make([]map[string]any, 0, len(cats))
	for _, c := range cats {
		categories = append(categories, map[string]any{
			"remote_id": strconv.FormatInt(c["id"].(int64), 10), "name": c["name"], "icon": c["icon"], "sort_order": c["sort_order"],
		})
	}

	rows, err := queryMaps(a.db, `SELECT * FROM content WHERE account_id = ? ORDER BY sort_order, id`, dev.AccountID)
	if err != nil {
		return err
	}
	content := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		src, _ := c["source_url"].(string)
		if k, _ := c["file_key"].(string); k != "" {
			src = a.fileURL(r, k)
		}
		thumb, _ := c["thumbnail_url"].(string)
		if k, _ := c["thumb_file_key"].(string); k != "" {
			thumb = a.fileURL(r, k)
		}
		var catRemote any
		if id, ok := c["category_id"].(int64); ok {
			catRemote = strconv.FormatInt(id, 10)
		}
		content = append(content, map[string]any{
			"remote_id":          strconv.FormatInt(c["id"].(int64), 10),
			"category_remote_id": catRemote,
			"title":              c["title"],
			"type":               c["type"],
			"source_url":         nullStr(src),
			"thumbnail":          nullStr(thumb),
			"description":        c["description"],
			"allowed_domains":    c["allowed_domains"],
			"is_approved":        c["is_approved"] == int64(1),
			"sort_order":         c["sort_order"],
		})
	}

	decisions, err := queryMaps(a.db, `SELECT local_id AS id, status FROM requests
		WHERE device_id = ? AND status <> 'pending' AND device_status = 'pending'`, dev.ID)
	if err != nil {
		return err
	}

	var limit, schedEnabled int
	var start, end string
	if err := a.db.QueryRow(`SELECT daily_limit_minutes, schedule_enabled, schedule_start, schedule_end FROM devices WHERE id = ?`, dev.ID).
		Scan(&limit, &schedEnabled, &start, &end); err != nil {
		return err
	}
	grants, err := queryMaps(a.db, `SELECT id, minutes FROM grants WHERE device_id = ? AND created_at > ? ORDER BY id`,
		dev.ID, time.Now().Add(-24*time.Hour).Unix())
	if err != nil {
		return err
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"full":              true,
		"device_name":       dev.Name,
		"categories":        categories,
		"content":           content,
		"request_decisions": decisions,
		"settings": map[string]string{
			"daily_limit_minutes": strconv.Itoa(limit),
			"schedule_enabled":    strconv.Itoa(schedEnabled),
			"schedule_start":      start,
			"schedule_end":        end,
		},
		"usage_grants": grants,
	})
	return nil
}

type eventsBody struct {
	Requests []struct {
		ID              int64   `json:"id"`
		ChildID         *int64  `json:"child_id"`
		ContentRemoteID *string `json:"content_remote_id"`
		ContentTitle    string  `json:"content_title"`
		ContentURL      *string `json:"content_url"`
		Status          string  `json:"status"`
		CreatedAt       *string `json:"created_at"`
		ResolvedAt      *string `json:"resolved_at"`
	} `json:"requests"`
	Activity []struct {
		ID              int64   `json:"id"`
		ChildID         *int64  `json:"child_id"`
		ContentRemoteID *string `json:"content_remote_id"`
		ContentTitle    *string `json:"content_title"`
		Action          string  `json:"action"`
		Detail          *string `json:"detail"`
		Timestamp       *string `json:"timestamp"`
	} `json:"activity"`
	Children *[]struct {
		ID     int64   `json:"id"`
		Name   string  `json:"name"`
		Age    *int64  `json:"age"`
		Avatar *string `json:"avatar"`
	} `json:"children"`
	Usage []struct {
		ChildID int64  `json:"child_id"`
		Day     string `json:"day"`
		Seconds int64  `json:"seconds"`
	} `json:"usage"`
	App *struct {
		Version string `json:"version"`
	} `json:"app"`
}

func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func truncPtr(s *string, n int) any {
	if s == nil {
		return nil
	}
	return trunc(*s, n)
}

// POST /api/v1/devices/{hw}/events -- requests, activity, child profiles and usage from a laptop.
func (a *App) events(w http.ResponseWriter, r *http.Request, dev *Device) error {
	var body eventsBody
	if err := readJSON(w, r, &body, 8<<20); err != nil {
		return err
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if body.Children != nil {
		if _, err := tx.Exec(`DELETE FROM device_children WHERE device_id = ?`, dev.ID); err != nil {
			return err
		}
		for _, c := range *body.Children {
			if c.Name == "" {
				continue
			}
			if _, err := tx.Exec(`INSERT OR REPLACE INTO device_children (device_id, local_id, name, age, avatar) VALUES (?, ?, ?, ?, ?)`,
				dev.ID, c.ID, trunc(c.Name, 100), c.Age, truncPtr(c.Avatar, 16)); err != nil {
				return err
			}
		}
	}
	for _, u := range body.Usage {
		if len(u.Day) != 10 || u.Seconds < 0 {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO device_usage (device_id, child_local_id, day, seconds) VALUES (?, ?, ?, ?)
			ON CONFLICT(device_id, child_local_id, day) DO UPDATE SET seconds = excluded.seconds`,
			dev.ID, u.ChildID, u.Day, u.Seconds); err != nil {
			return err
		}
	}
	for _, q := range body.Requests {
		if q.Status != "pending" && q.Status != "approved" && q.Status != "denied" {
			continue
		}
		if q.ContentTitle == "" {
			continue
		}
		_, err := tx.Exec(`INSERT INTO requests (device_id, local_id, child_local_id, content_remote_id, content_title, content_url,
			status, device_status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(device_id, local_id) DO UPDATE SET
			  device_status = excluded.device_status,
			  status = CASE WHEN requests.status = 'pending' THEN excluded.device_status ELSE requests.status END,
			  resolved_at = COALESCE(requests.resolved_at, excluded.resolved_at)`,
			dev.ID, q.ID, q.ChildID, truncPtr(q.ContentRemoteID, 40), trunc(q.ContentTitle, 300), truncPtr(q.ContentURL, 2000),
			q.Status, q.Status, truncPtr(q.CreatedAt, 40), truncPtr(q.ResolvedAt, 40))
		if err != nil {
			return err
		}
	}
	for _, e := range body.Activity {
		if e.Action == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO activity (device_id, local_id, child_local_id, content_remote_id, content_title,
			action, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			dev.ID, e.ID, e.ChildID, truncPtr(e.ContentRemoteID, 40), truncPtr(e.ContentTitle, 300), trunc(e.Action, 40),
			truncPtr(e.Detail, 1000), truncPtr(e.Timestamp, 40)); err != nil {
			return err
		}
	}
	if body.App != nil {
		if _, err := tx.Exec(`UPDATE devices SET app_version = ? WHERE id = ?`, trunc(body.App.Version, 40), dev.ID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}
