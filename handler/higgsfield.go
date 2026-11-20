package handler

import (
	"encoding/json"
	"fmt"
	"io"
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
func normalizeHiggsfieldBody(body []byte, contentType string, modelName string, channel model.ModelChannel) ([]byte, string, error) {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "application/json") {
		return body, contentType, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return body, contentType, nil
	}
	// size → aspect_ratio
	if size, ok := payload["size"].(string); ok && strings.TrimSpace(size) != "" {
		if ratio := higgsfieldAspectRatio(size); ratio != "" {
			payload["aspect_ratio"] = ratio
		}
	}
	// Higgsfield 端点在 URL 里，body 不需要 model / size / response_format
	delete(payload, "model")
	delete(payload, "size")
	delete(payload, "response_format")
	// n（张数）→ num_images 由 Higgsfield 自行处理，保留原字段名以兼容
	encoded, err := json.Marshal(payload)
	if err != nil {
		return body, contentType, err
	}
	return encoded, "application/json", nil
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
