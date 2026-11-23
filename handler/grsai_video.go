package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

// grsai 视频协议：POST {base}/v1/api/generate 提交，GET {base}/v1/api/result?id= 查询。
// 支持 wan-3.0（wan-video）与 minimax-h3，返回体形如
// {"id":"...","status":"succeeded","results":[{"url":"..."}],"usage":{"credits":2700}}。

func isGrsaiVideoChannel(channel model.ModelChannel, _ string) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), service.ModelChannelProtocolGrsaiVideo)
}

// normalizeGrsaiVideoBody 把前端通用视频请求（multipart 或 JSON）转成 grsai 的 JSON 体。
func normalizeGrsaiVideoBody(body []byte, contentType string, modelName string, channel model.ModelChannel) ([]byte, string, error) {
	payload, err := readGrsaiVideoPayload(body, contentType)
	if err != nil {
		return nil, contentType, err
	}
	// replyType=async 让 /api/generate 立即返回任务 id，再轮询 /api/result；
	// 默认的 json 会同步阻塞到视频生成完（实测 5 秒视频挂满 300 秒仍不返回）。
	out := map[string]any{"replyType": "async"}
	modelValue := strings.TrimSpace(modelName)
	if modelValue == "" {
		modelValue = firstGrsaiString(payload, "model")
	}
	if modelValue != "" {
		out["model"] = modelValue
	}
	if prompt := firstGrsaiString(payload, "prompt"); prompt != "" {
		out["prompt"] = prompt
	}
	if value := firstGrsaiString(payload, "duration", "seconds"); value != "" {
		if number, convErr := strconv.Atoi(strings.TrimSuffix(strings.TrimSuffix(value, "s"), "秒")); convErr == nil && number > 0 {
			out["duration"] = number
		}
	}
	if value := firstGrsaiString(payload, "resolution", "resolution_name", "quality"); value != "" {
		out["resolution"] = normalizeGrsaiResolution(value)
	}
	if value := firstGrsaiString(payload, "aspectRatio", "aspect_ratio", "size"); value != "" {
		out["aspectRatio"] = normalizeGrsaiAspect(value)
	}
	if images := grsaiStringList(payload, "images", "input_reference[]", "input_reference"); len(images) > 0 {
		out["images"] = images
	}
	if first := firstGrsaiString(payload, "firstFrame", "first_frame_url"); first != "" {
		out["firstFrame"] = first
	}
	if last := firstGrsaiString(payload, "lastFrame", "last_frame_url"); last != "" {
		out["lastFrame"] = last
	}
	if videos := grsaiURLObjects(payload, "videos", "video_reference[]"); len(videos) > 0 {
		out["videos"] = videos
	}
	if audios := grsaiStringList(payload, "audios", "audio_reference[]"); len(audios) > 0 {
		out["audios"] = audios
	}
	if seed := firstGrsaiString(payload, "seed"); seed != "" {
		if number, convErr := strconv.Atoi(seed); convErr == nil {
			out["seed"] = number
		}
	}
	encoded, err := json.Marshal(out)
	return encoded, "application/json", err
}

func readGrsaiVideoPayload(body []byte, contentType string) (map[string]any, error) {
	if !strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
		payload := map[string]any{}
		_ = json.Unmarshal(body, &payload)
		return payload, nil
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, err
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return nil, err
	}
	defer form.RemoveAll()
	payload := map[string]any{}
	for key, values := range form.Value {
		if len(values) == 0 {
			continue
		}
		if len(values) == 1 {
			payload[key] = strings.TrimSpace(values[0])
			continue
		}
		items := make([]string, 0, len(values))
		for _, value := range values {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				items = append(items, trimmed)
			}
		}
		payload[key] = items
	}
	// 本地参考图会被前端当作文件上传，这里转成 dataURL 塞进同一字段，
	// grsai 的 images/audios 只接受地址，dataURL 是最省事的直传形态。
	for key, headers := range form.File {
		values := grsaiPayloadStrings(payload[key])
		for _, header := range headers {
			file, openErr := header.Open()
			if openErr != nil {
				continue
			}
			data, readErr := io.ReadAll(file)
			_ = file.Close()
			if readErr != nil || len(data) == 0 {
				continue
			}
			mimeType := header.Header.Get("Content-Type")
			if strings.TrimSpace(mimeType) == "" {
				mimeType = http.DetectContentType(data)
			}
			values = append(values, "data:"+mimeType+";base64,"+base64.StdEncoding.EncodeToString(data))
		}
		if len(values) == 1 {
			payload[key] = values[0]
		} else if len(values) > 1 {
			payload[key] = values
		}
	}
	return payload, nil
}

func grsaiPayloadStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		if trimmed := strings.TrimSpace(typed); trimmed != "" {
			return []string{trimmed}
		}
	case []string:
		return typed
	case []any:
		var result []string
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	}
	return nil
}

func firstGrsaiString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case string:
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		case float64:
			return strconv.FormatFloat(value, 'f', -1, 64)
		case int:
			return strconv.Itoa(value)
		case json.Number:
			return value.String()
		}
	}
	return ""
}

func grsaiStringList(payload map[string]any, keys ...string) []string {
	var result []string
	for _, key := range keys {
		switch value := payload[key].(type) {
		case string:
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				result = append(result, trimmed)
			}
		case []string:
			result = append(result, value...)
		case []any:
			for _, item := range value {
				if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
					result = append(result, strings.TrimSpace(text))
				}
			}
		}
	}
	return result
}

func grsaiURLObjects(payload map[string]any, keys ...string) []map[string]string {
	var result []map[string]string
	for _, url := range grsaiStringList(payload, keys...) {
		result = append(result, map[string]string{"url": url})
	}
	return result
}

func normalizeGrsaiResolution(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(lower, "480"):
		return "480p"
	case strings.Contains(lower, "768"):
		return "768p"
	case strings.Contains(lower, "1080"):
		return "1080p"
	case strings.Contains(lower, "720"):
		return "720p"
	}
	return lower
}

// normalizeGrsaiAspect 保留 16:9 / 9:16 这类比例；portrait/landscape 原样交给上游。
func normalizeGrsaiAspect(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	for _, keyword := range []string{"portrait", "landscape", "square"} {
		if lower == keyword {
			return keyword
		}
	}
	if strings.Contains(trimmed, ":") || strings.Contains(lower, "x") {
		return trimmed
	}
	return trimmed
}

func grsaiVideoStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "succeeded", "success", "completed", "complete", "done":
		return "completed"
	case "failed", "error", "cancelled", "canceled":
		return "failed"
	case "running", "processing", "generating":
		return "processing"
	case "queued", "pending", "waiting":
		return "queued"
	}
	return "processing"
}

func grsaiErrorMessage(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		if message, ok := typed["message"].(string); ok {
			return strings.TrimSpace(message)
		}
		if reason, ok := typed["error"].(string); ok {
			return strings.TrimSpace(reason)
		}
	}
	return ""
}

// transformGrsaiVideoResponse 把 grsai 的 {id,status,results} 转成项目内部视频任务格式。
func transformGrsaiVideoResponse(payload []byte, modelName string) ([]byte, bool) {
	var raw struct {
		ID       string  `json:"id"`
		TaskID   string  `json:"task_id"`
		Status   string  `json:"status"`
		Progress float64 `json:"progress"`
		Error    any     `json:"error"`
		Results []struct {
			URL string `json:"url"`
		} `json:"results"`
		Usage struct {
			Credits float64 `json:"credits"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, false
	}
	taskID := strings.TrimSpace(raw.ID)
	if taskID == "" {
		taskID = strings.TrimSpace(raw.TaskID)
	}
	if taskID == "" {
		return nil, false
	}
	converted := map[string]any{
		"id":     taskID,
		"object": "video",
		"status": grsaiVideoStatus(raw.Status),
		"model":  modelName,
	}
	// 上游是 running + progress 的百分比，前端进度条靠它，别丢。
	if raw.Progress > 0 {
		converted["progress"] = int(raw.Progress)
	}
	if videoURL := firstGrsaiResultURL(raw.Results); videoURL != "" {
		converted["video"] = map[string]any{"url": videoURL}
		converted["url"] = videoURL
		converted["data"] = []map[string]any{{"url": videoURL}}
		converted["progress"] = 100
	}
	if message := grsaiErrorMessage(raw.Error); message != "" {
		converted["error"] = message
	}
	if raw.Usage.Credits > 0 {
		converted["usage"] = map[string]any{"credits": raw.Usage.Credits}
	}
	encoded, err := json.Marshal(converted)
	if err != nil {
		return nil, false
	}
	return encoded, true
}

func firstGrsaiResultURL(results []struct {
	URL string `json:"url"`
}) string {
	for _, item := range results {
		if trimmed := strings.TrimSpace(item.URL); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
