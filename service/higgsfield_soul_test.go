package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestBuildSoulReferenceCreateBody(t *testing.T) {
	body, err := BuildSoulReferenceCreateBody(SoulReferenceCreate{
		Name: "街拍模特", Authorized: true,
		ImageURLs: []string{"https://example.com/front.jpg", " https://example.com/side.jpg "},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got["model_version"] != "v2" {
		t.Fatalf("model_version = %v", got["model_version"])
	}
	if _, ok := got["style_id"]; ok {
		t.Fatalf("style_id should not be invented: %#v", got)
	}
	images, _ := got["input_images"].([]any)
	if len(images) != 2 {
		t.Fatalf("images = %#v", images)
	}
	if _, err := BuildSoulReferenceCreateBody(SoulReferenceCreate{Name: "A", ImageURLs: []string{"https://example.com/a.jpg"}}); err == nil {
		t.Fatal("unauthorized training should fail")
	}
	if _, err := BuildSoulReferenceCreateBody(SoulReferenceCreate{Name: "A", Authorized: true, ImageURLs: []string{"data:image/png;base64,aaaa"}}); err == nil {
		t.Fatal("data url should be uploaded before the create body")
	}
}

func TestCreateAndListSoulReferenceUsesChannelKey(t *testing.T) {
	var gotAuth, gotPath, gotQuery string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		if r.Body != nil {
			raw, _ := io.ReadAll(r.Body)
			if len(raw) > 0 {
				_ = json.Unmarshal(raw, &gotBody)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/custom-references":
			_, _ = io.WriteString(w, `{"id":"11111111-1111-4111-8111-111111111111","name":"街拍模特","model_version":"v2","status":"queued","thumbnail_url":"https://cdn.example/thumb.jpg"}`)
		case "/v1/custom-references/list":
			_, _ = io.WriteString(w, `{"total":1,"page":1,"page_size":20,"total_pages":1,"items":[{"id":"11111111-1111-4111-8111-111111111111","name":"街拍模特","model_version":"v2","status":"completed"}]}`)
		default:
			_, _ = io.WriteString(w, `{"id":"11111111-1111-4111-8111-111111111111","status":"completed","model_version":"v2"}`)
		}
	}))
	defer server.Close()
	channel := model.ModelChannel{Protocol: ModelChannelProtocolHiggsfield, BaseURL: server.URL, APIKey: "key-id:key-secret", Timeout: 5}

	created, err := CreateSoulReference(context.Background(), channel, SoulReferenceCreate{
		Name: "街拍模特", Authorized: true, ImageURLs: []string{"https://example.com/front.jpg"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Key key-id:key-secret" || gotPath != "/v1/custom-references" {
		t.Fatalf("create auth=%s path=%s", gotAuth, gotPath)
	}
	if gotBody["model_version"] != "v2" {
		t.Fatalf("create body = %#v", gotBody)
	}
	if created.Status != "queued" || created.ModelVersion != "v2" || created.Warning == "" {
		t.Fatalf("created = %#v", created)
	}

	page, err := ListSoulReferences(context.Background(), channel, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/custom-references/list" || gotQuery != "page=1&page_size=20" {
		t.Fatalf("list path=%s query=%s", gotPath, gotQuery)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Status != "completed" {
		t.Fatalf("page = %#v", page)
	}

	item, err := GetSoulReference(context.Background(), channel, "11111111-1111-4111-8111-111111111111")
	if err != nil || item.Status != "completed" {
		t.Fatalf("get status=%s err=%v", item.Status, err)
	}
	if _, err := GetSoulReference(context.Background(), channel, "../admin"); err == nil {
		t.Fatal("invalid soul id should not be requested")
	}
}

func TestStreetOutfitSkillIsDefaultPackage(t *testing.T) {
	packages, err := readDefaultAgentSkillPackages()
	if err != nil {
		t.Fatal(err)
	}
	var found defaultAgentSkillPackage
	for _, item := range packages {
		if item.Name == "Soul 2.0 街拍穿搭" {
			found = item
		}
	}
	if found.Root == "" {
		t.Fatal("missing Soul 2.0 street outfit skill")
	}
	for _, phrase := range []string{"edit_image", "clothingSwap", "model_version", "custom_reference", "Vertical 3:4"} {
		if !strings.Contains(found.Content, phrase) {
			t.Fatalf("skill missing %s", phrase)
		}
	}
	if strings.Contains(found.Content, "3db34ab5-3439-4317-9e03-08dc30852e69") {
		t.Fatal("skill invented a style id")
	}
}

func TestMissingDefaultAgentSkillPackages(t *testing.T) {
	packages := []defaultAgentSkillPackage{{Root: "skills/old.md"}, {Root: "skills/soul-street-outfit.md"}}
	oldID := defaultAgentSkillID(packages[0].Root)
	newID := defaultAgentSkillID(packages[1].Root)
	missing := missingDefaultAgentSkillPackages(packages, map[string]struct{}{oldID: {}}, nil)
	if len(missing) != 1 || missing[0].Root != "skills/soul-street-outfit.md" {
		t.Fatalf("missing = %#v", missing)
	}
	dismissed := missingDefaultAgentSkillPackages(packages, map[string]struct{}{oldID: {}}, map[string]struct{}{newID: {}})
	if len(dismissed) != 0 {
		t.Fatalf("dismissed skill returned: %#v", dismissed)
	}
}
