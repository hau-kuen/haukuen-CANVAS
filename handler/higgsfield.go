package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func isHiggsfieldChannel(channel model.ModelChannel, _ string) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), service.ModelChannelProtocolHiggsfield)
}

// normalizeHiggsfieldBody 把 OpenAI 格式的图片请求体转成 Higgsfield 格式。
// 第三个返回值表示本次请求是否携带参考图（参考图会被转成公网 image_url，供 prepare 路由到 image-to-image 端点）。
func normalizeHiggsfieldBody(body []byte, contentType string, modelName string, channel model.ModelChannel) ([]byte, string, bool, error) {
	payload, hasReference, err := higgsfieldPayload(body, contentType, channel)
	if err != nil || payload == nil {
		return body, contentType, false, err
	}
	// 换装必须走图片编辑模型。Soul image-to-image 会把 image_url 当成场景/构图参考，不能只换衣服。
	if higgsfieldClothingSwap(payload) {
		return nil, "", false, errors.New("换装请使用图片编辑模型，不要提交到 Soul image-to-image")
	}
	// 参考图：JSON 里以 image/image_url 等字段出现的 dataUrl 或 http URL 统一转成公网 image_url
	if ref := higgsfieldExtractReference(payload, channel); ref != "" {
		payload["image_url"] = ref
		higgsfieldClearReferenceFields(payload)
		hasReference = true
	}
	// 画幅：优先用调用方显式 aspect_ratio，其次由 size 换算，最后吸附到 Higgsfield 支持的画幅
	ratio := higgsfieldStringValue(payload["aspect_ratio"])
	if ratio == "" {
		ratio = higgsfieldAspectRatio(higgsfieldStringValue(payload["size"]))
	}
	if snapped := higgsfieldSnapAspectRatio(ratio); snapped != "" {
		payload["aspect_ratio"] = snapped
	}
	// 清晰度：Soul 只有 720p / 1080p 两档，不传会落到最低档，出图明显发糊
	if _, ok := payload["resolution"]; !ok {
		payload["resolution"] = higgsfieldResolution(higgsfieldStringValue(payload["quality"]))
	}
	// 张数：OpenAI 的 n 在 Higgsfield 上分别是 num_images / batch_size
	// 带参考图走 image-to-image，仅支持单张，不设置张数。
	if !hasReference {
		if count := higgsfieldImageCount(payload); count > 0 {
			if strings.Contains(strings.ToLower(modelName), "soul/v2") {
				payload["batch_size"] = 4
				if count < 4 {
					delete(payload, "batch_size")
				}
			} else {
				payload["num_images"] = count
			}
		}
	}
	if err := applyHiggsfieldSoulReference(payload, channel); err != nil {
		return nil, "", false, err
	}
	// Higgsfield 端点在 URL 里，body 里这些 OpenAI 字段会被上游拒绝或忽略。
	// 不补 style_id：上游有自己的默认风格，这里不编造 Moodboard UUID。
	for _, key := range []string{"model", "size", "quality", "response_format", "n", "count", "clothing_swap", "reference_role"} {
		delete(payload, key)
	}
	if higgsfieldStringValue(payload["style_id"]) == "" {
		delete(payload, "style_id")
	}
	// enhance_prompt 默认开启：让 Higgsfield 对 prompt 做增强优化，否则默认 false，复杂需求出图质量差
	if _, ok := payload["enhance_prompt"]; !ok {
		payload["enhance_prompt"] = true
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return body, contentType, false, err
	}
	return encoded, "application/json", hasReference, nil
}

// higgsfieldPayload 把请求体解析成 map；multipart 表单会提取参考图文件并上传成公网 URL。
func higgsfieldPayload(body []byte, contentType string, channel model.ModelChannel) (map[string]any, bool, error) {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if strings.HasPrefix(ct, "multipart/form-data") {
		payload, refBytes, refMime, err := higgsfieldMultipartPayload(body, contentType)
		if err != nil {
			return nil, false, err
		}
		if refBytes != nil {
			url, err := uploadHiggsfieldImage(refBytes, refMime, channel)
			if err != nil {
				return nil, false, err
			}
			payload["image_url"] = url
			return payload, true, nil
		}
		return payload, false, nil
	}
	if !strings.HasPrefix(ct, "application/json") {
		return nil, false, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, false, err
	}
	return payload, false, nil
}

// higgsfieldMultipartPayload 解析 multipart 表单，返回 JSON payload 与参考图文件字节。
func higgsfieldMultipartPayload(body []byte, contentType string) (map[string]any, []byte, string, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, nil, "", err
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return nil, nil, "", err
	}
	defer form.RemoveAll()
	payload := map[string]any{}
	for key, values := range form.Value {
		if len(values) > 0 {
			payload[key] = values[0]
		}
	}
	for _, field := range []string{"image", "image_url", "file"} {
		if headers, ok := form.File[field]; ok && len(headers) > 0 {
			file, err := headers[0].Open()
			if err != nil {
				return nil, nil, "", err
			}
			data, _ := io.ReadAll(file)
			_ = file.Close()
			return payload, data, headers[0].Header.Get("Content-Type"), nil
		}
	}
	return payload, nil, "", nil
}

// higgsfieldExtractReference 从 payload 提取参考图，返回公网 URL（空表示无参考图）。
func higgsfieldExtractReference(payload map[string]any, channel model.ModelChannel) string {
	for _, key := range []string{"image", "image_url", "image_urls", "reference_image", "reference_image_url", "input_url"} {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case string:
			if url := higgsfieldPublicReference(v, channel); url != "" {
				return url
			}
		case []any:
			for _, item := range v {
				if text, ok := item.(string); ok {
					if url := higgsfieldPublicReference(text, channel); url != "" {
						return url
					}
				}
			}
		}
	}
	return ""
}

// higgsfieldPublicReference 把单个参考图值转成公网 URL：dataUrl 上传，http(s) 直用。
func higgsfieldPublicReference(value string, channel model.ModelChannel) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "data:") {
		data, mimeType, err := decodeDataURL(value)
		if err != nil {
			return ""
		}
		url, err := uploadHiggsfieldImage(data, mimeType, channel)
		if err != nil {
			return ""
		}
		return url
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return ""
}

// higgsfieldClearReferenceFields 清掉 OpenAI 风格的参考图字段，image_url 保留作为 image-to-image 参数。
func higgsfieldClearReferenceFields(payload map[string]any) {
	for _, key := range []string{"image", "images", "image_urls", "reference_image", "reference_images", "reference_image_url", "reference_image_urls", "input_url", "input_urls", "input_reference", "input_reference[]", "image_input", "file"} {
		delete(payload, key)
	}
}

// decodeDataURL 解析 data:image/...;base64,... 为原始字节和 MIME 类型。
func decodeDataURL(value string) ([]byte, string, error) {
	comma := strings.Index(value, ",")
	if comma < 0 {
		return nil, "", fmt.Errorf("invalid data url")
	}
	meta, data := value[:comma], value[comma+1:]
	mimeType := "image/png"
	lower := strings.ToLower(meta)
	if strings.Contains(lower, "image/jpeg") || strings.Contains(lower, "image/jpg") {
		mimeType = "image/jpeg"
	} else if strings.Contains(lower, "image/webp") {
		mimeType = "image/webp"
	}
	raw := []byte(data)
	if strings.Contains(lower, ";base64") {
		decoded, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return nil, "", err
		}
		raw = decoded
	}
	return raw, mimeType, nil
}

// uploadHiggsfieldImage 把图片字节上传到 Higgsfield CDN，返回公网 URL。
func uploadHiggsfieldImage(data []byte, mimeType string, channel model.ModelChannel) (string, error) {
	if strings.TrimSpace(mimeType) == "" || isGenericBinaryMIME(mimeType) {
		mimeType = http.DetectContentType(data)
	}
	// 1. 申请上传链接
	linkBody, _ := json.Marshal(map[string]any{"content_type": mimeType})
	linkReq, err := http.NewRequest(http.MethodPost, service.BuildModelChannelURL(channel, "/files/generate-upload-url"), bytes.NewReader(linkBody))
	if err != nil {
		return "", err
	}
	linkReq.Header.Set("Authorization", "Key "+channel.APIKey)
	linkReq.Header.Set("Content-Type", "application/json")
	linkResp, err := service.HTTPClientForChannel(channel).Do(linkReq)
	if err != nil {
		return "", err
	}
	linkPayload, _ := io.ReadAll(io.LimitReader(linkResp.Body, 1<<20))
	_ = linkResp.Body.Close()
	if linkResp.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("Higgsfield upload link failed: %s", readUpstreamAIErrorMessage(linkPayload, linkResp.StatusCode))
	}
	var link struct {
		UploadURL     string            `json:"upload_url"`
		PublicURL     string            `json:"public_url"`
		ContentType   string            `json:"content_type"`
		UploadHeaders map[string]string `json:"upload_headers"`
	}
	if err := json.Unmarshal(linkPayload, &link); err != nil {
		return "", err
	}
	if strings.TrimSpace(link.UploadURL) == "" || strings.TrimSpace(link.PublicURL) == "" {
		return "", fmt.Errorf("Higgsfield upload link empty")
	}
	// 2. PUT 上传字节，必须带上服务端返回的 upload_headers（含 x-amz-tagging 等签名头），否则 403 签名不匹配
	putReq, err := http.NewRequest(http.MethodPut, link.UploadURL, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	for key, value := range link.UploadHeaders {
		putReq.Header.Set(key, value)
	}
	if strings.TrimSpace(putReq.Header.Get("Content-Type")) == "" {
		putReq.Header.Set("Content-Type", mimeType)
	}
	putResp, err := service.HTTPClientForChannel(channel).Do(putReq)
	if err != nil {
		return "", err
	}
	_ = putResp.Body.Close()
	if putResp.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("Higgsfield upload failed: HTTP %d", putResp.StatusCode)
	}
	return link.PublicURL, nil
}

// isGenericBinaryMIME 判断是否是未指定具体类型的二进制 MIME（multipart 默认值），这类需要按字节自动检测。
func isGenericBinaryMIME(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "application/octet-stream", "application/binary", "binary", "":
		return true
	default:
		return false
	}
}

func higgsfieldClothingSwap(payload map[string]any) bool {
	switch value := payload["clothing_swap"].(type) {
	case bool:
		if value {
			return true
		}
	case string:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "1", "true", "yes":
			return true
		}
	}
	switch strings.ToLower(higgsfieldStringValue(payload["reference_role"])) {
	case "garment", "clothing", "outfit":
		return true
	default:
		return false
	}
}

// higgsfieldUpstreamImagePath 决定 Soul 出图端点。只有场景参考图走 image-to-image；换装不进这个函数。
func higgsfieldUpstreamImagePath(modelName string, hasReference bool) string {
	name := strings.TrimPrefix(strings.TrimSpace(modelName), "/")
	if name == "" {
		return ""
	}
	if hasReference && strings.Contains(strings.ToLower(name), "soul/v2") {
		return "/higgsfield-ai/soul/v2/image-to-image"
	}
	return "/" + name
}

func applyHiggsfieldSoulReference(payload map[string]any, channel model.ModelChannel) error {
	id := higgsfieldStringValue(payload["custom_reference_id"])
	if id == "" {
		delete(payload, "custom_reference_id")
		delete(payload, "custom_reference_strength")
		return nil
	}
	if !service.SoulReferenceID(id) {
		return errors.New("custom_reference_id 必须是 Soul ID")
	}
	strength, ok, err := higgsfieldReferenceStrength(payload["custom_reference_strength"])
	if err != nil {
		return err
	}
	if !ok {
		strength = 1
	}
	if strength <= 0 || strength > 1 {
		return errors.New("custom_reference_strength 必须大于 0 且不超过 1")
	}
	item, err := service.GetSoulReference(context.Background(), channel, id)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(item.Status), "completed") {
		return errors.New("Soul ID 尚未训练完成，不能用于出图")
	}
	payload["custom_reference_id"] = id
	payload["custom_reference_strength"] = strength
	return nil
}

func higgsfieldReferenceStrength(value any) (float64, bool, error) {
	switch strength := value.(type) {
	case nil:
		return 0, false, nil
	case float64:
		return strength, true, nil
	case float32:
		return float64(strength), true, nil
	case int:
		return float64(strength), true, nil
	case int64:
		return float64(strength), true, nil
	case json.Number:
		parsed, err := strength.Float64()
		if err != nil {
			return 0, false, errors.New("custom_reference_strength 必须大于 0 且不超过 1")
		}
		return parsed, true, nil
	case string:
		text := strings.TrimSpace(strength)
		if text == "" {
			return 0, false, nil
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false, errors.New("custom_reference_strength 必须大于 0 且不超过 1")
		}
		return parsed, true, nil
	default:
		return 0, false, errors.New("custom_reference_strength 必须大于 0 且不超过 1")
	}
}

func higgsfieldAspectRatio(size string) string {
	switch strings.ToLower(strings.TrimSpace(size)) {
	case "1024x1024", "512x512", "768x768":
		return "1:1"
	case "1024x768", "1280x960", "1440x1080":
		return "4:3"
	case "768x1024", "960x1280":
		return "3:4"
	case "1920x1080", "1280x720":
		return "16:9"
	case "1080x1920", "720x1280":
		return "9:16"
	}
	parts := strings.SplitN(strings.ToLower(strings.TrimSpace(size)), "x", 2)
	if len(parts) != 2 {
		return ""
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return ""
	}
	g := gcdPositive(w, h)
	if g == 0 {
		return ""
	}
	return fmt.Sprintf("%d:%d", w/g, h/g)
}

func gcdPositive(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func higgsfieldStringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

// Higgsfield 只接受固定画幅，任意尺寸换算出的比例要吸附到最接近的一档，否则上游直接 400。
var higgsfieldAspectRatios = []struct {
	name  string
	value float64
}{
	{"1:1", 1},
	{"4:3", 4.0 / 3},
	{"3:4", 3.0 / 4},
	{"3:2", 1.5},
	{"2:3", 2.0 / 3},
	{"16:9", 16.0 / 9},
	{"9:16", 9.0 / 16},
}

func higgsfieldSnapAspectRatio(ratio string) string {
	parts := strings.SplitN(strings.TrimSpace(ratio), ":", 2)
	if len(parts) != 2 {
		return ""
	}
	w, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	h, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return ""
	}
	target := w / h
	best, bestDiff := "", math.MaxFloat64
	for _, item := range higgsfieldAspectRatios {
		if diff := math.Abs(target - item.value); diff < bestDiff {
			best, bestDiff = item.name, diff
		}
	}
	return best
}

// higgsfieldResolution 决定出图清晰度：Soul 只有 720p / 1080p，不传时上游按最低档出图。
func higgsfieldResolution(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "low", "720p", "1k", "1.5k", "fast", "draft":
		return "720p"
	default:
		return "1080p"
	}
}

func higgsfieldImageCount(payload map[string]any) int {
	for _, key := range []string{"n", "count"} {
		switch value := payload[key].(type) {
		case float64:
			if value >= 1 {
				return min(int(value), 4)
			}
		case int:
			if value >= 1 {
				return min(value, 4)
			}
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && parsed >= 1 {
				return min(parsed, 4)
			}
		}
	}
	return 0
}

// copyHiggsfieldResponse 拦截 Higgsfield 图片提交响应：先提交拿 request_id，再轮询到结果。
func copyHiggsfieldResponse(w http.ResponseWriter, response *http.Response, request *http.Request, channel model.ModelChannel, context aiLogContext, onFailure func()) bool {
	if !isHiggsfieldChannel(channel, context.Model) {
		return false
	}
	payload, _ := io.ReadAll(response.Body)
	_, statusURL, ok := readHiggsfieldCreateTask(payload)
	if !ok {
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(payload)
		saveAIProxyLog(context, response.StatusCode, string(payload), "")
		return true
	}
	imageURLs, errMessage := pollHiggsfieldTask(request, channel, statusURL)
	if errMessage != "" {
		if onFailure != nil {
			onFailure()
		}
		writeHiggsfieldImageError(w, response.StatusCode, errMessage, context)
		return true
	}
	writeHiggsfieldImagesResponse(w, response.StatusCode, imageURLs, context)
	return true
}

func readHiggsfieldCreateTask(payload []byte) (string, string, bool) {
	var result struct {
		RequestID string `json:"request_id"`
		StatusURL string `json:"status_url"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return "", "", false
	}
	if strings.TrimSpace(result.RequestID) == "" {
		return "", "", false
	}
	statusURL := result.StatusURL
	if strings.TrimSpace(statusURL) == "" {
		statusURL = "/requests/" + result.RequestID + "/status"
	}
	return result.RequestID, statusURL, true
}

func pollHiggsfieldTask(request *http.Request, channel model.ModelChannel, statusURL string) ([]string, string) {
	if !strings.HasPrefix(statusURL, "http://") && !strings.HasPrefix(statusURL, "https://") {
		statusURL = service.BuildModelChannelURL(channel, statusURL)
	}
	for attempt := 0; attempt < 300; attempt++ {
		if attempt > 0 {
			select {
			case <-request.Context().Done():
				return nil, request.Context().Err().Error()
			case <-time.After(2 * time.Second):
			}
		}
		pollRequest, err := http.NewRequestWithContext(request.Context(), http.MethodGet, statusURL, nil)
		if err != nil {
			return nil, err.Error()
		}
		pollRequest.Header.Set("Authorization", "Key "+channel.APIKey)
		resp, err := service.HTTPClientForChannel(channel).Do(pollRequest)
		if err != nil {
			return nil, err.Error()
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
		_ = resp.Body.Close()
		if resp.StatusCode >= http.StatusBadRequest {
			return nil, readUpstreamAIErrorMessage(body, resp.StatusCode)
		}
		imageURLs, done, errMessage := readHiggsfieldTaskResult(body)
		if errMessage != "" {
			return nil, errMessage
		}
		if done {
			if len(imageURLs) == 0 {
				return nil, "Higgsfield image task completed but returned no image URL"
			}
			return imageURLs, ""
		}
	}
	return nil, "Higgsfield image task timed out"
}

func readHiggsfieldTaskResult(payload []byte) ([]string, bool, string) {
	var result struct {
		Status string `json:"status"`
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return nil, false, err.Error()
	}
	switch strings.ToLower(strings.TrimSpace(result.Status)) {
	case "completed", "succeeded", "success":
		var urls []string
		for _, img := range result.Images {
			if strings.TrimSpace(img.URL) != "" {
				urls = append(urls, img.URL)
			}
		}
		return urls, true, ""
	case "failed", "nsfw", "canceled":
		return nil, false, firstNonEmpty(result.Error, "Higgsfield image task "+result.Status)
	default:
		return nil, false, ""
	}
}

func writeHiggsfieldImagesResponse(w http.ResponseWriter, statusCode int, imageURLs []string, logContext aiLogContext) {
	items := make([]map[string]any, 0, len(imageURLs))
	for _, imageURL := range imageURLs {
		items = append(items, map[string]any{"url": imageURL})
	}
	converted := map[string]any{"created": time.Now().Unix(), "data": items}
	encoded, _ := json.Marshal(converted)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_, _ = w.Write(encoded)
	saveAIProxyLog(logContext, statusCode, string(encoded), "")
}

func writeHiggsfieldImageError(w http.ResponseWriter, statusCode int, message string, logContext aiLogContext) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	body, _ := json.Marshal(map[string]any{"error": map[string]any{"message": message}})
	_, _ = w.Write(body)
	saveAIProxyLog(logContext, statusCode, string(body), "")
}
