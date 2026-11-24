package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

// 文件内容签名 URL。
//
// 设计原则：默认关闭（SIGNED_URL_REQUIRED=false），存量画布数据里的
// /api/files/{id}/content 直链继续可用；开启后必须带 exp + sig 才能读取，
// 用于局域网多人协作时收紧文件访问面。
//
// 签名串 = HMAC-SHA256(key, "objectID|exp")，key 优先取 URL_SIGN_KEY，
// 未配置时退化为 JWT_SECRET（同一进程内稳定即可，签名有效期很短）。

var (
	ErrSignedURLRequired = errors.New("需要签名链接")
	ErrSignedURLInvalid  = errors.New("签名链接无效或已过期")
)

// signedURLKey 返回当前使用的签名密钥。
func signedURLKey() []byte {
	if key := strings.TrimSpace(config.Cfg.URLSignKey); key != "" {
		return []byte(key)
	}
	if key := strings.TrimSpace(config.Cfg.JWTSecret); key != "" {
		return []byte(key)
	}
	return []byte("infinite-canvas-sign")
}

// SignedURLRequired 表示是否强制校验文件签名。
func SignedURLRequired() bool {
	return config.Cfg.SignedURLRequired
}

// DefaultSignedURLTTL 返回默认签名有效期。
func DefaultSignedURLTTL() time.Duration {
	ttl := config.Cfg.SignedURLTTLSeconds
	if ttl <= 0 {
		ttl = 3600
	}
	return time.Duration(ttl) * time.Second
}

// SignStorageObjectURL 为对象生成带签名与过期时间的相对访问路径。
func SignStorageObjectURL(objectID string, ttl time.Duration) string {
	if ttl <= 0 {
		ttl = DefaultSignedURLTTL()
	}
	exp := time.Now().Add(ttl).Unix()
	sig := signStorageObject(objectID, exp)
	return "/api/files/" + objectID + "/content?exp=" + strconv.FormatInt(exp, 10) + "&sig=" + sig
}

// VerifyStorageObjectURL 校验签名参数。
func VerifyStorageObjectURL(objectID, expRaw, sig string) error {
	exp, err := strconv.ParseInt(strings.TrimSpace(expRaw), 10, 64)
	if err != nil || exp <= 0 {
		return ErrSignedURLInvalid
	}
	if time.Now().Unix() > exp {
		return ErrSignedURLInvalid
	}
	expected := signStorageObject(objectID, exp)
	if !hmac.Equal([]byte(expected), []byte(strings.TrimSpace(sig))) {
		return ErrSignedURLInvalid
	}
	return nil
}

func signStorageObject(objectID string, exp int64) string {
	mac := hmac.New(sha256.New, signedURLKey())
	mac.Write([]byte(objectID + "|" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}
