package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const soulReferenceModelVersion = "v2"

var soulReferenceIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// SoulReference 是 Higgsfield 账号下的一个 Soul ID。
type SoulReference struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ModelVersion string `json:"modelVersion"`
	Status       string `json:"status"`
	ThumbnailURL string `json:"thumbnailUrl"`
	CreatedAt    string `json:"createdAt"`
	InProgressAt string `json:"inProgressAt"`
	FailReason   string `json:"failReason"`
}

// SoulReferencePage 是 Soul ID 列表的一页。
type SoulReferencePage struct {
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
	TotalPages int             `json:"totalPages"`
	Items      []SoulReference `json:"items"`
}

// SoulReferenceCreate 是创建 Soul 2.0 角色的入参。Authorized 必须为 true。
type SoulReferenceCreate struct {
	Name       string
	ImageURLs  []string
	Authorized bool
}

// SoulReferenceCreated 在上游角色对象之外附带训练张数提醒。
type SoulReferenceCreated struct {
	SoulReference
	Warning string `json:"warning,omitempty"`
}

// SoulReferenceID 判断字符串是否为 Soul ID 的 UUID。
func SoulReferenceID(id string) bool {
	return soulReferenceIDPattern.MatchString(strings.TrimSpace(id))
}

// BuildSoulReferenceCreateBody 组装 POST /v1/custom-references。model_version 固定为 v2。
func BuildSoulReferenceCreateBody(input SoulReferenceCreate) ([]byte, error) {
	if !input.Authorized {
		return nil, safeMessageError{message: "训练 Soul ID 前必须确认照片中的人物已授权"}
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return nil, safeMessageError{message: "请填写不超过 100 字的角色名"}
	}
	if len(input.ImageURLs) < 1 || len(input.ImageURLs) > 100 {
		return nil, safeMessageError{message: "训练图片需要 1 到 100 张"}
	}
	images := make([]map[string]string, 0, len(input.ImageURLs))
	for _, raw := range input.ImageURLs {
		imageURL := strings.TrimSpace(raw)
		if !strings.HasPrefix(imageURL, "https://") && !strings.HasPrefix(imageURL, "http://") {
			return nil, safeMessageError{message: "训练图片必须是可公开访问的 URL"}
		}
		if len(imageURL) > 2083 {
			return nil, safeMessageError{message: "训练图片 URL 过长"}
		}
		images = append(images, map[string]string{"type": "image_url", "image_url": imageURL})
	}
	return json.Marshal(map[string]any{
		"name":          name,
		"model_version": soulReferenceModelVersion,
		"input_images":  images,
	})
}

// ResolveHiggsfieldChannel 用现有渠道 Key 找到 Higgsfield 渠道，不另开一套鉴权。
func ResolveHiggsfieldChannel(ctx context.Context, publicChannelID string, userChannelID string) (model.ModelChannel, error) {
	userChannelID = strings.TrimSpace(userChannelID)
	if userChannelID != "" {
		user, ok := UserFromContext(ctx)
		if !ok || user.ID == "" {
			return model.ModelChannel{}, safeMessageError{message: "请先登录"}
		}
		return SelectUserHiggsfieldChannel(user.ID, userChannelID)
	}
	return SelectPublicHiggsfieldChannel(publicChannelID)
}

// SelectPublicHiggsfieldChannel 从系统渠道里选取 Higgsfield。
func SelectPublicHiggsfieldChannel(channelID string) (model.ModelChannel, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.ModelChannel{}, err
	}
	channels := higgsfieldChannels(normalizePrivateSetting(settings.Private).Channels)
	return pickHiggsfieldChannel(channels, channelID)
}

func higgsfieldChannels(channels []model.ModelChannel) []model.ModelChannel {
	matched := make([]model.ModelChannel, 0, len(channels))
	for _, channel := range channels {
		if channel.Enabled && higgsfieldChannelReady(channel) {
			matched = append(matched, channel)
		}
	}
	return matched
}

func pickHiggsfieldChannel(channels []model.ModelChannel, channelID string) (model.ModelChannel, error) {
	channelID = strings.TrimSpace(channelID)
	if channelID != "" {
		for _, channel := range channels {
			if channel.ID == channelID {
				return channel, nil
			}
		}
		return model.ModelChannel{}, safeMessageError{message: "指定模型渠道不可用"}
	}
	if len(channels) == 0 {
		return model.ModelChannel{}, safeMessageError{message: "没有可用的 Higgsfield 渠道"}
	}
	return channels[0], nil
}

func higgsfieldChannelReady(channel model.ModelChannel) bool {
	protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
	if protocol != ModelChannelProtocolHiggsfield && !higgsfieldModelList(channel.Models) {
		return false
	}
	return strings.TrimSpace(channel.BaseURL) != "" && strings.TrimSpace(channel.APIKey) != ""
}

func higgsfieldModelList(models []string) bool {
	for _, item := range models {
		name := strings.ToLower(strings.TrimSpace(item))
		if strings.Contains(name, "higgsfield") || strings.Contains(name, "soul") {
			return true
		}
	}
	return false
}

// ListSoulReferences 读取 Higgsfield 账号里已有的 Soul ID。
func ListSoulReferences(ctx context.Context, channel model.ModelChannel, page int, pageSize int) (SoulReferencePage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	values := url.Values{}
	values.Set("page", strconv.Itoa(page))
	values.Set("page_size", strconv.Itoa(pageSize))
	body, err := higgsfieldSoulRequest(ctx, channel, http.MethodGet, "/v1/custom-references/list?"+values.Encode(), nil)
	if err != nil {
		return SoulReferencePage{}, err
	}
	return parseSoulReferencePage(body), nil
}

// GetSoulReference 轮询一个 Soul ID 的训练状态。
func GetSoulReference(ctx context.Context, channel model.ModelChannel, id string) (SoulReference, error) {
	id = strings.TrimSpace(id)
	if !SoulReferenceID(id) {
		return SoulReference{}, safeMessageError{message: "Soul ID 无效"}
	}
	body, err := higgsfieldSoulRequest(ctx, channel, http.MethodGet, "/v1/custom-references/"+id, nil)
	if err != nil {
		return SoulReference{}, err
	}
	return parseSoulReference(body), nil
}

// CreateSoulReference 用 model_version=v2 创建 Soul 2.0 角色，并返回当前状态。
func CreateSoulReference(ctx context.Context, channel model.ModelChannel, input SoulReferenceCreate) (SoulReferenceCreated, error) {
	payload, err := BuildSoulReferenceCreateBody(input)
	if err != nil {
		return SoulReferenceCreated{}, err
	}
	body, err := higgsfieldSoulRequest(ctx, channel, http.MethodPost, "/v1/custom-references", payload)
	if err != nil {
		return SoulReferenceCreated{}, err
	}
	created := SoulReferenceCreated{SoulReference: parseSoulReference(body)}
	if len(input.ImageURLs) < 20 {
		created.Warning = "官方训练通常需要 20 张以上多角度照片，当前张数较少，身份可能不稳定"
	}
	return created, nil
}

func higgsfieldSoulRequest(ctx context.Context, channel model.ModelChannel, method string, path string, payload []byte) ([]byte, error) {
	if !higgsfieldChannelReady(channel) {
		return nil, safeMessageError{message: "Higgsfield 渠道密钥未配置"}
	}
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, BuildModelChannelURL(channel, path), reader)
	if err != nil {
		return nil, err
	}
	SetModelChannelAuthHeader(request, channel)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := HTTPClientForChannel(channel).Do(request)
	if err != nil {
		return nil, safeMessageError{message: "Higgsfield Soul ID 请求失败"}
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode == http.StatusTooManyRequests {
		wait := strings.TrimSpace(response.Header.Get("Retry-After"))
		if wait != "" {
			return nil, safeMessageError{message: "Soul ID 同时训练数量已满，请 " + wait + " 秒后重试"}
		}
		return nil, safeMessageError{message: "Soul ID 同时训练数量已满，请稍后重试"}
	}
	if response.StatusCode >= http.StatusBadRequest {
		return nil, safeMessageError{message: higgsfieldSoulError(body, response.StatusCode)}
	}
	return body, nil
}

func higgsfieldSoulError(body []byte, status int) string {
	var payload struct {
		Detail any    `json:"detail"`
		Error  any    `json:"error"`
		Msg    string `json:"msg"`
	}
	_ = json.Unmarshal(body, &payload)
	message := strings.TrimSpace(payload.Msg)
	if message == "" {
		message = higgsfieldSoulDetail(payload.Detail)
	}
	if message == "" {
		message = higgsfieldSoulDetail(payload.Error)
	}
	if message == "" {
		return "Higgsfield Soul ID 请求失败：" + strconv.Itoa(status)
	}
	if len(message) > 300 {
		message = message[:300]
	}
	return message
}

func higgsfieldSoulDetail(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case map[string]any:
		if text, ok := item["message"].(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func parseSoulReferencePage(body []byte) SoulReferencePage {
	var payload struct {
		Total      int               `json:"total"`
		Page       int               `json:"page"`
		PageSize   int               `json:"page_size"`
		TotalPages int               `json:"total_pages"`
		Items      []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return SoulReferencePage{Items: []SoulReference{}}
	}
	items := make([]SoulReference, 0, len(payload.Items))
	for _, item := range payload.Items {
		items = append(items, parseSoulReference(item))
	}
	if items == nil {
		items = []SoulReference{}
	}
	return SoulReferencePage{Total: payload.Total, Page: payload.Page, PageSize: payload.PageSize, TotalPages: payload.TotalPages, Items: items}
}

func parseSoulReference(body []byte) SoulReference {
	var payload struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		ModelVersion string `json:"model_version"`
		Status       string `json:"status"`
		ThumbnailURL string `json:"thumbnail_url"`
		CreatedAt    string `json:"created_at"`
		InProgressAt string `json:"in_progress_at"`
		FailReason   string `json:"fail_reason"`
	}
	_ = json.Unmarshal(body, &payload)
	return SoulReference{
		ID:           payload.ID,
		Name:         payload.Name,
		ModelVersion: payload.ModelVersion,
		Status:       payload.Status,
		ThumbnailURL: payload.ThumbnailURL,
		CreatedAt:    payload.CreatedAt,
		InProgressAt: payload.InProgressAt,
		FailReason:   payload.FailReason,
	}
}
