package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestHiggsfieldSoulCreateChecksAuthorizationBeforeUpload(t *testing.T) {
	const marker = "HIGGSFIELD_SOUL_AUTH_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestHiggsfieldSoulCreateChecksAuthorizationBeforeUpload$", "-test.timeout=40s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated soul auth test: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	var hits []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/files/generate-upload-url":
			_, _ = io.WriteString(w, `{"upload_url":"`+serverURLPlaceholder(r)+`/upload","public_url":"https://cdn.example/portrait.png","upload_headers":{}}`)
		case "/upload":
			w.WriteHeader(http.StatusOK)
		case "/v1/custom-references":
			body, _ := io.ReadAll(r.Body)
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			if payload["model_version"] != "v2" {
				t.Errorf("model_version = %v", payload["model_version"])
			}
			_, _ = io.WriteString(w, `{"id":"11111111-1111-4111-8111-111111111111","name":"模特","model_version":"v2","status":"queued"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previous })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{{
		ID: "hf", Protocol: "higgsfield", Name: "Higgsfield", BaseURL: server.URL, APIKey: "key-id:key-secret",
		Models: []string{"higgsfield-ai/soul/v2/standard"}, Enabled: true, Weight: 1, Timeout: 5,
	}}}}, "2026-11-23T00:00:00Z"); err != nil {
		t.Fatal(err)
	}

	dataURL := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	unauthorized := postSoulCreate(t, `{"name":"模特","authorized":false,"imageUrls":["`+dataURL+`"]}`)
	if unauthorized.Code == 0 || !strings.Contains(unauthorized.Msg, "授权") {
		t.Fatalf("unauthorized response = %#v", unauthorized)
	}
	if len(hits) != 0 {
		t.Fatalf("unauthorized request uploaded photos: %v", hits)
	}

	created := postSoulCreate(t, `{"name":"模特","authorized":true,"imageUrls":["`+dataURL+`"]}`)
	if created.Code != 0 {
		t.Fatalf("authorized response = %#v", created)
	}
	joined := strings.Join(hits, "\n")
	if !strings.Contains(joined, "POST /files/generate-upload-url") || !strings.Contains(joined, "POST /v1/custom-references") {
		t.Fatalf("authorized request did not upload then create: %v", hits)
	}
}

func postSoulCreate(t *testing.T, body string) struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
} {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/higgsfield/soul-ids", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	HiggsfieldSoulIDs(recorder, request)
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func serverURLPlaceholder(r *http.Request) string {
	return "http://" + r.Host
}
