package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type client struct {
	t     *testing.T
	base  string
	token string
}

func (c *client) do(method, path string, body any, out any) int {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rdr)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func newTestServer(t *testing.T) (*httptest.Server, *App) {
	cfg := Config{DataDir: t.TempDir(), Secret: []byte(strings.Repeat("k", 32)), MaxUploadBytes: 10 << 20}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(app.Routes())
	t.Cleanup(func() { srv.Close(); app.db.Close() })
	return srv, app
}

func TestFullFlow(t *testing.T) {
	srv, _ := newTestServer(t)
	parent := &client{t: t, base: srv.URL}

	// First account can register; a second one cannot (signup closed by default).
	var auth map[string]any
	if code := parent.do("POST", "/api/v1/auth/register", map[string]string{"email": "mum@example.org", "password": "longpassword"}, &auth); code != 200 {
		t.Fatalf("register: %d", code)
	}
	if code := (&client{t: t, base: srv.URL}).do("POST", "/api/v1/auth/register", map[string]string{"email": "x@example.org", "password": "longpassword"}, nil); code != 403 {
		t.Fatalf("second register should be forbidden, got %d", code)
	}
	if code := (&client{t: t, base: srv.URL}).do("POST", "/api/v1/auth/login", map[string]string{"email": "mum@example.org", "password": "wrong"}, nil); code != 401 {
		t.Fatalf("bad login: %d", code)
	}
	parent.token = auth["token"].(string)
	if code := (&client{t: t, base: srv.URL}).do("GET", "/api/v1/devices", nil, nil); code != 401 {
		t.Fatalf("unauthenticated list should be 401, got %d", code)
	}

	// Categories are seeded.
	var cats []map[string]any
	parent.do("GET", "/api/v1/categories", nil, &cats)
	if len(cats) != 3 {
		t.Fatalf("expected 3 seeded categories, got %d", len(cats))
	}
	videoCat := cats[0]["id"]

	// Upload a PDF and create content from it.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "worksheet.pdf")
	fw.Write([]byte("%PDF-1.4 test"))
	mw.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/files", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+parent.token)
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("upload failed: %v %v", err, res.StatusCode)
	}
	var up map[string]any
	json.NewDecoder(res.Body).Decode(&up)
	res.Body.Close()

	var created map[string]any
	if code := parent.do("POST", "/api/v1/content", map[string]any{"title": "Worksheet", "type": "pdf", "file_key": up["key"], "is_approved": false}, &created); code != 200 {
		t.Fatalf("create pdf: %d", code)
	}
	pdfID := int64(created["id"].(float64))
	if code := parent.do("POST", "/api/v1/content", map[string]any{"title": "Wrong", "type": "video", "file_key": up["key"]}, nil); code != 400 {
		t.Fatalf("pdf file as video should be rejected, got %d", code)
	}
	parent.do("POST", "/api/v1/content", map[string]any{"title": "Khan", "type": "site", "source_url": "https://www.khanacademy.org", "category_id": cats[2]["id"]}, &created)
	siteID := int64(created["id"].(float64))
	parent.do("POST", "/api/v1/content", map[string]any{"title": "Volcano", "type": "video", "source_url": "https://example.org/v.mp4", "category_id": videoCat}, nil)

	// Register a laptop.
	var dev map[string]any
	parent.do("POST", "/api/v1/devices", map[string]string{"name": "Ada's laptop"}, &dev)
	devID := int64(dev["id"].(float64))
	laptop := &client{t: t, base: srv.URL, token: dev["token"].(string)}
	parent.do("PATCH", "/api/v1/devices/"+itoa(devID), map[string]any{"daily_limit_minutes": 45, "schedule_enabled": true, "schedule_start": "07:30", "schedule_end": "19:00"}, nil)
	parent.do("POST", "/api/v1/devices/"+itoa(devID)+"/grants", map[string]int{"minutes": 15}, nil)

	// Laptop pulls its library.
	var lib map[string]any
	if code := laptop.do("GET", "/api/v1/devices/hw-123/library", nil, &lib); code != 200 {
		t.Fatalf("library: %d", code)
	}
	content := lib["content"].([]any)
	if len(content) != 3 || lib["full"] != true {
		t.Fatalf("expected 3 items, full=true; got %d %v", len(content), lib["full"])
	}
	var pdfURL string
	for _, c := range content {
		m := c.(map[string]any)
		if m["title"] == "Worksheet" {
			pdfURL = m["source_url"].(string)
			if m["is_approved"] != false {
				t.Fatal("worksheet should be locked")
			}
		}
	}
	settings := lib["settings"].(map[string]any)
	if settings["daily_limit_minutes"] != "45" || settings["schedule_start"] != "07:30" || len(lib["usage_grants"].([]any)) != 1 {
		t.Fatalf("settings/grants not delivered: %v %v", settings, lib["usage_grants"])
	}

	// Signed download works, tampered signature does not, range requests work.
	r1, _ := http.Get(pdfURL)
	body, _ := io.ReadAll(r1.Body)
	r1.Body.Close()
	if r1.StatusCode != 200 || string(body) != "%PDF-1.4 test" {
		t.Fatalf("download: %d %q", r1.StatusCode, body)
	}
	r2, _ := http.Get(pdfURL[:len(pdfURL)-2] + "00")
	r2.Body.Close()
	if r2.StatusCode != 404 {
		t.Fatalf("tampered link should 404, got %d", r2.StatusCode)
	}
	rq, _ := http.NewRequest("GET", pdfURL, nil)
	rq.Header.Set("Range", "bytes=0-3")
	r3, _ := http.DefaultClient.Do(rq)
	b3, _ := io.ReadAll(r3.Body)
	r3.Body.Close()
	if r3.StatusCode != 206 || string(b3) != "%PDF" {
		t.Fatalf("range: %d %q", r3.StatusCode, b3)
	}

	// Laptop pushes children, usage, a locked-item request and a blocked-page request.
	pdfRemote, siteRemote := itoa(pdfID), itoa(siteID)
	events := map[string]any{
		"children": []map[string]any{{"id": 1, "name": "Ada", "age": 8, "avatar": "🦊"}},
		"usage":    []map[string]any{{"child_id": 1, "day": "2026-10-12", "seconds": 1200}},
		"requests": []map[string]any{
			{"id": 10, "child_id": 1, "content_remote_id": pdfRemote, "content_title": "Worksheet", "status": "pending", "created_at": "2026-10-12 10:00:00"},
			{"id": 11, "child_id": 1, "content_remote_id": siteRemote, "content_title": "Visit youtube.com", "content_url": "https://www.youtube.com/watch?v=1", "status": "pending"},
		},
		"activity": []map[string]any{{"id": 5, "child_id": 1, "content_title": "Khan", "action": "open", "timestamp": "2026-10-12 10:01:00"}},
		"app":      map[string]string{"version": "1.0.0"},
	}
	if code := laptop.do("POST", "/api/v1/devices/hw-123/events", events, nil); code != 200 {
		t.Fatalf("events: %d", code)
	}
	laptop.do("POST", "/api/v1/devices/hw-123/events", events, nil) // idempotent

	var devices []map[string]any
	parent.do("GET", "/api/v1/devices", nil, &devices)
	children := devices[0]["children"].([]any)
	if devices[0]["hardware_id"] != "hw-123" || len(children) != 1 || children[0].(map[string]any)["usage_seconds"].(float64) != 1200 {
		t.Fatalf("device info: %+v", devices[0])
	}

	var reqs []map[string]any
	parent.do("GET", "/api/v1/requests?status=pending", nil, &reqs)
	if len(reqs) != 2 || reqs[0]["child_name"] != "Ada" {
		t.Fatalf("requests: %+v", reqs)
	}
	var acts []map[string]any
	parent.do("GET", "/api/v1/activity", nil, &acts)
	if len(acts) != 1 || acts[0]["device_name"] != "Ada's laptop" {
		t.Fatalf("activity: %+v", acts)
	}

	// Parent approves both; effects land in the library and decisions are delivered.
	for _, q := range reqs {
		var out map[string]any
		parent.do("POST", "/api/v1/requests/"+itoa(int64(q["id"].(float64)))+"/resolve", map[string]string{"status": "approved"}, &out)
		if out["effect"] == "" {
			t.Fatalf("no effect for %v", q)
		}
	}
	laptop.do("GET", "/api/v1/devices/hw-123/library", nil, &lib)
	if n := len(lib["request_decisions"].([]any)); n != 2 {
		t.Fatalf("expected 2 decisions, got %d", n)
	}
	for _, c := range lib["content"].([]any) {
		m := c.(map[string]any)
		if m["title"] == "Worksheet" && m["is_approved"] != true {
			t.Fatal("worksheet should now be approved")
		}
		if m["title"] == "Khan" && !strings.Contains(m["allowed_domains"].(string), "youtube.com") {
			t.Fatalf("youtube should be allowed: %v", m["allowed_domains"])
		}
	}
	// Once the laptop reports the decisions applied, they stop being sent.
	events["requests"] = []map[string]any{
		{"id": 10, "content_title": "Worksheet", "status": "approved"},
		{"id": 11, "content_title": "Visit youtube.com", "status": "approved"},
	}
	laptop.do("POST", "/api/v1/devices/hw-123/events", events, nil)
	laptop.do("GET", "/api/v1/devices/hw-123/library", nil, &lib)
	if n := len(lib["request_decisions"].([]any)); n != 0 {
		t.Fatalf("decisions should be cleared, got %d", n)
	}

	if code := parent.do("DELETE", "/api/v1/content/999999", nil, nil); code != 404 {
		t.Fatalf("delete unknown: %d", code)
	}

	// Rotating the token disconnects the old one.
	var rot map[string]any
	parent.do("POST", "/api/v1/devices/"+itoa(devID)+"/token", nil, &rot)
	if code := laptop.do("GET", "/api/v1/devices/hw-123/library", nil, nil); code != 401 {
		t.Fatalf("old token should fail, got %d", code)
	}

	// Deleting content removes its file.
	parent.do("DELETE", "/api/v1/content/"+pdfRemote, nil, nil)
	r4, _ := http.Get(pdfURL)
	r4.Body.Close()
	if r4.StatusCode != 404 {
		t.Fatalf("deleted file should 404, got %d", r4.StatusCode)
	}
}

func TestAccountIsolation(t *testing.T) {
	srv, app := newTestServer(t)
	app.cfg.AllowSignup = true
	a := &client{t: t, base: srv.URL}
	b := &client{t: t, base: srv.URL}
	var ra, rb map[string]any
	a.do("POST", "/api/v1/auth/register", map[string]string{"email": "a@x.org", "password": "longpassword"}, &ra)
	b.do("POST", "/api/v1/auth/register", map[string]string{"email": "b@x.org", "password": "longpassword"}, &rb)
	a.token, b.token = ra["token"].(string), rb["token"].(string)

	var created map[string]any
	a.do("POST", "/api/v1/content", map[string]any{"title": "Mine", "type": "site", "source_url": "https://a.org"}, &created)
	id := itoa(int64(created["id"].(float64)))
	if code := b.do("PATCH", "/api/v1/content/"+id, map[string]any{"title": "Stolen", "type": "site", "source_url": "https://b.org"}, nil); code != 404 {
		t.Fatalf("cross-account edit should 404, got %d", code)
	}
	var list []map[string]any
	b.do("GET", "/api/v1/content", nil, &list)
	if len(list) != 0 {
		t.Fatalf("b should see no content, got %d", len(list))
	}
	var dev map[string]any
	a.do("POST", "/api/v1/devices", map[string]string{"name": "A laptop"}, &dev)
	if code := b.do("DELETE", "/api/v1/devices/"+itoa(int64(dev["id"].(float64))), nil, nil); code != 200 {
		t.Fatalf("delete returns ok, got %d", code)
	}
	var devs []map[string]any
	a.do("GET", "/api/v1/devices", nil, &devs)
	if len(devs) != 1 {
		t.Fatal("b must not be able to delete a's device")
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
