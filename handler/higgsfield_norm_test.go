package handler

import (
	"encoding/json"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestNormalizeHiggsfieldBody(t *testing.T) {
	cases := []struct {
		name    string
		model   string
		body    string
		want    map[string]any
		notWant []string
	}{
		{
			name:    "画布默认尺寸补清晰度",
			model:   "higgsfield-ai/soul/v2/standard",
			body:    `{"model":"higgsfield-ai/soul/v2/standard","prompt":"shoe","quality":"auto","size":"864x1152"}`,
			want:    map[string]any{"aspect_ratio": "3:4", "resolution": "1080p", "enhance_prompt": true},
			notWant: []string{"size", "quality", "model"},
		},
		{
			name:  "非标准比例吸附到最近画幅",
			model: "higgsfield-ai/soul/v2/standard",
			body:  `{"prompt":"shoe","size":"1280x800"}`,
			want:  map[string]any{"aspect_ratio": "3:2"},
		},
		{
			name:  "方形画幅",
			model: "higgsfield-ai/soul/v2/standard",
			body:  `{"prompt":"shoe","size":"1024x1024"}`,
			want:  map[string]any{"aspect_ratio": "1:1"},
		},
		{
			name:  "低质量档降到720p",
			model: "higgsfield-ai/soul/v2/standard",
			body:  `{"prompt":"shoe","quality":"low"}`,
			want:  map[string]any{"resolution": "720p"},
		},
		{
			name:  "v2 四张走 batch_size",
			model: "higgsfield-ai/soul/v2/standard",
			body:  `{"prompt":"shoe","n":4}`,
			want:  map[string]any{"batch_size": 4.0},
		},
		{
			name:  "standard 四张走 num_images",
			model: "higgsfield-ai/soul/standard",
			body:  `{"prompt":"shoe","n":4}`,
			want:  map[string]any{"num_images": 4.0},
		},
		{
			name:    "http参考图转image_url并保留",
			model:   "higgsfield-ai/soul/v2/standard",
			body:    `{"prompt":"shoe","image":"https://example.com/ref.jpg","size":"1024x1024"}`,
			want:    map[string]any{"image_url": "https://example.com/ref.jpg", "aspect_ratio": "1:1", "enhance_prompt": true},
			notWant: []string{"image"},
		},
	}
	for _, c := range cases {
		encoded, _, _, err := normalizeHiggsfieldBody([]byte(c.body), "application/json", c.model, model.ModelChannel{Protocol: "higgsfield"})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		var got map[string]any
		_ = json.Unmarshal(encoded, &got)
		for key, value := range c.want {
			if got[key] != value {
				t.Errorf("%s: %s = %v, want %v (body %s)", c.name, key, got[key], value, encoded)
			}
		}
		for _, key := range c.notWant {
			if _, ok := got[key]; ok {
				t.Errorf("%s: %s 应被删除 (body %s)", c.name, key, encoded)
			}
		}
	}
}

func TestIsGenericBinaryMIME(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"application/octet-stream", true},
		{"APPLICATION/OCTET-STREAM", true},
		{" application/octet-stream ", true},
		{"application/binary", true},
		{"binary", true},
		{"", true},
		{"image/png", false},
		{"image/jpeg", false},
		{"image/webp", false},
	}
	for _, c := range cases {
		if got := isGenericBinaryMIME(c.in); got != c.want {
			t.Errorf("isGenericBinaryMIME(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
