package service

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

func TestSignedStorageObjectURL(t *testing.T) {
	config.Cfg.URLSignKey = "test-sign-key"

	id := "obj-123"

	t.Run("有效签名通过", func(t *testing.T) {
		url := SignStorageObjectURL(id, time.Minute)
		exp, sig := parseSignedQuery(t, url)
		if err := VerifyStorageObjectURL(id, exp, sig); err != nil {
			t.Fatalf("期望通过，实际 %v", err)
		}
	})

	t.Run("换成别的对象ID失败", func(t *testing.T) {
		url := SignStorageObjectURL(id, time.Minute)
		exp, sig := parseSignedQuery(t, url)
		if err := VerifyStorageObjectURL("obj-999", exp, sig); err == nil {
			t.Fatal("篡改对象ID后不应通过")
		}
	})

	t.Run("篡改签名失败", func(t *testing.T) {
		url := SignStorageObjectURL(id, time.Minute)
		exp, _ := parseSignedQuery(t, url)
		if err := VerifyStorageObjectURL(id, exp, strings.Repeat("0", 64)); err == nil {
			t.Fatal("错误签名不应通过")
		}
	})

	t.Run("过期失败", func(t *testing.T) {
		exp := time.Now().Add(-time.Second).Unix()
		sig := signStorageObject(id, exp)
		if err := VerifyStorageObjectURL(id, strconv.FormatInt(exp, 10), sig); err == nil {
			t.Fatal("过期链接不应通过")
		}
	})

	t.Run("ttl非正数回退默认有效期", func(t *testing.T) {
		url := SignStorageObjectURL(id, -time.Second)
		exp, sig := parseSignedQuery(t, url)
		if err := VerifyStorageObjectURL(id, exp, sig); err != nil {
			t.Fatalf("应回退为默认有效期并可通过，实际 %v", err)
		}
	})

	t.Run("缺参数失败", func(t *testing.T) {
		if err := VerifyStorageObjectURL(id, "", ""); err == nil {
			t.Fatal("缺参数不应通过")
		}
	})

	t.Run("换密钥后旧签名失效", func(t *testing.T) {
		url := SignStorageObjectURL(id, time.Minute)
		exp, sig := parseSignedQuery(t, url)
		config.Cfg.URLSignKey = "another-key"
		defer func() { config.Cfg.URLSignKey = "test-sign-key" }()
		if err := VerifyStorageObjectURL(id, exp, sig); err == nil {
			t.Fatal("换密钥后旧签名不应通过")
		}
	})
}

func TestSignedURLSwitch(t *testing.T) {
	config.Cfg.SignedURLRequired = false
	if SignedURLRequired() {
		t.Fatal("默认应为关闭")
	}
	config.Cfg.SignedURLRequired = true
	defer func() { config.Cfg.SignedURLRequired = false }()
	if !SignedURLRequired() {
		t.Fatal("开关打开后应为 true")
	}
}

// parseSignedQuery 从生成的路径里取出 exp 和 sig。
func parseSignedQuery(t *testing.T, url string) (string, string) {
	t.Helper()
	index := strings.Index(url, "?")
	if index < 0 {
		t.Fatalf("URL 缺少查询串: %s", url)
	}
	var exp, sig string
	for _, pair := range strings.Split(url[index+1:], "&") {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			continue
		}
		switch parts[0] {
		case "exp":
			exp = parts[1]
		case "sig":
			sig = parts[1]
		}
	}
	if exp == "" || sig == "" {
		t.Fatalf("URL 缺少 exp/sig: %s", url)
	}
	return exp, sig
}
