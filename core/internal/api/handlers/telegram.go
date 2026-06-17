package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/notify"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
)

// TelegramHandler handles /telegram-bots endpoints.
type TelegramHandler struct {
	Store    *store.Store
	Notifier *notify.Notifier
}

// NewTelegramHandler constructs.
func NewTelegramHandler(s *store.Store, n *notify.Notifier) *TelegramHandler {
	return &TelegramHandler{Store: s, Notifier: n}
}

type tgBotReq struct {
	Name         string                    `json:"name"`
	BotToken     string                    `json:"bot_token"`
	ChatID       string                    `json:"chat_id"`
	Enabled      bool                      `json:"enabled"`
	Config       models.SubscriptionConfig `json:"config"`
	MsgFormat    models.TelegramMsgFormat  `json:"msg_format"`
	ThrottleSecs int                       `json:"throttle_secs"`
}

// trim strips stray whitespace/newlines from copy-pasted credentials so a
// trailing space can't cause Telegram auth / "chat not found" failures.
func (r *tgBotReq) trim() {
	r.Name = strings.TrimSpace(r.Name)
	r.BotToken = strings.TrimSpace(r.BotToken)
	r.ChatID = strings.TrimSpace(r.ChatID)
}

// List returns all bots for the org.
func (h *TelegramHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	bots, err := h.Store.ListTelegramBots(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list bots")
		return
	}
	writeJSON(w, http.StatusOK, bots)
}

// Create registers a new bot.
func (h *TelegramHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req tgBotReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.trim()
	if req.Name == "" || req.BotToken == "" || req.ChatID == "" {
		writeError(w, http.StatusBadRequest, "name, bot_token and chat_id are required")
		return
	}
	bot := &models.TelegramBot{
		OrgID: orgID, Name: req.Name, BotToken: req.BotToken, ChatID: req.ChatID,
		Enabled: req.Enabled, Config: req.Config, MsgFormat: req.MsgFormat, ThrottleSecs: req.ThrottleSecs,
	}
	id, err := h.Store.CreateTelegramBot(r.Context(), bot)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create bot")
		return
	}
	h.audit(r, "telegram-bot.create", id, req.Name)
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// Update edits an existing bot. An empty bot_token preserves the stored secret.
func (h *TelegramHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if _, err := h.Store.GetTelegramBot(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusNotFound, "bot not found")
		return
	}
	var req tgBotReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.trim()
	if req.Name == "" || req.ChatID == "" {
		writeError(w, http.StatusBadRequest, "name and chat_id are required")
		return
	}
	bot := &models.TelegramBot{
		ID: id, OrgID: orgID, Name: req.Name, BotToken: req.BotToken, ChatID: req.ChatID,
		Enabled: req.Enabled, Config: req.Config, MsgFormat: req.MsgFormat, ThrottleSecs: req.ThrottleSecs,
	}
	if err := h.Store.UpdateTelegramBot(r.Context(), bot); err != nil {
		writeError(w, http.StatusInternalServerError, "update bot")
		return
	}
	h.audit(r, "telegram-bot.update", id, req.Name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// Delete removes a bot.
func (h *TelegramHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.DeleteTelegramBot(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete bot")
		return
	}
	h.audit(r, "telegram-bot.delete", id, "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Toggle enables/disables a bot.
func (h *TelegramHandler) Toggle(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		Enabled bool `json:"enabled"`
	}
	_ = readJSON(r, &req)
	if err := h.Store.SetTelegramBotEnabled(r.Context(), orgID, id, req.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "toggle bot")
		return
	}
	h.audit(r, "telegram-bot.toggle", id, "")
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": req.Enabled})
}

// Test sends a synchronous test message and reports the Telegram result.
func (h *TelegramHandler) Test(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	bot, err := h.Store.GetTelegramBot(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "bot not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	if err := h.Notifier.SendTest(ctx, bot); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	_ = h.Store.TouchTelegramBotSent(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (h *TelegramHandler) audit(r *http.Request, action string, id int64, detail string) {
	uid := middleware.UserID(r.Context())
	orgID := middleware.OrgID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, action, "telegram_bot", &rid, detail)
}
