package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

type soulReferenceCreateRequest struct {
	Name       string   `json:"name"`
	Authorized bool     `json:"authorized"`
	ImageURLs  []string `json:"imageUrls"`
}

func HiggsfieldSoulIDs(w http.ResponseWriter, r *http.Request) {
	channel, err := resolveHiggsfieldSoulChannel(r)
	if err != nil {
		FailError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(firstNonEmpty(r.URL.Query().Get("pageSize"), r.URL.Query().Get("page_size")))
		pageData, err := service.ListSoulReferences(r.Context(), channel, page, pageSize)
		if err != nil {
			FailError(w, err)
			return
		}
		OK(w, pageData)
		return
	}
	var input soulReferenceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "Soul ID 数据格式错误")
		return
	}
	imageURLs, err := publicSoulImageURLs(input.ImageURLs, channel)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	created, err := service.CreateSoulReference(r.Context(), channel, service.SoulReferenceCreate{
		Name: input.Name, ImageURLs: imageURLs, Authorized: input.Authorized,
	})
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, created)
}

func HiggsfieldSoulID(w http.ResponseWriter, r *http.Request, id string) {
	channel, err := resolveHiggsfieldSoulChannel(r)
	if err != nil {
		FailError(w, err)
		return
	}
	item, err := service.GetSoulReference(r.Context(), channel, id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, item)
}

func resolveHiggsfieldSoulChannel(r *http.Request) (model.ModelChannel, error) {
	return service.ResolveHiggsfieldChannel(r.Context(), r.Header.Get("X-Model-Channel-ID"), r.Header.Get(userModelChannelHeader))
}

func publicSoulImageURLs(values []string, channel model.ModelChannel) ([]string, error) {
	urls := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "data:") {
			data, mimeType, err := decodeDataURL(value)
			if err != nil {
				return nil, errors.New("训练图片无法读取")
			}
			uploaded, err := uploadHiggsfieldImage(data, mimeType, channel)
			if err != nil {
				return nil, err
			}
			urls = append(urls, uploaded)
			continue
		}
		urls = append(urls, value)
	}
	return urls, nil
}
