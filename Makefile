# OpenClaw Command Center
# Usage: make [target]
#
# Runs dashboard in tmux for easy inspection and management

TMUX_SESSION := openclaw-dashboard
LOG_DIR := $(HOME)/.openclaw-command-center/logs
LOG_FILE := $(LOG_DIR)/dashboard.log
DASHBOARD_DIR := $(CURDIR)
PORT := 3333

.DEFAULT_GOAL := help
.PHONY: help ensure start stop restart status logs attach clean release

# Include local overrides if they exist (not tracked in git)
-include Makefile.local

help: ## Show this help
	@echo "OpenClaw Command Center - tmux-based management"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sed 's/^[^:]*://' | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Quick start: make start && make attach"

ensure: ## Ensure dashboard is running (idempotent, self-healing)
	@mkdir -p $(LOG_DIR)
	@touch $(LOG_FILE)
	@if ! command -v tmux >/dev/null 2>&1; then \
		echo "❌ tmux not found. Please install tmux."; \
		exit 1; \
	fi
	@if ! command -v node >/dev/null 2>&1; then \
		echo "❌ node not found. Please install node."; \
		exit 1; \
	fi
	@if ! tmux has-session -t $(TMUX_SESSION) 2>/dev/null; then \
		echo "Creating tmux session '$(TMUX_SESSION)'..."; \
		tmux new-session -d -s $(TMUX_SESSION) -c $(DASHBOARD_DIR) \
			"./scripts/dashboard-loop.sh; echo '[Loop exited - shell ready]'; exec bash -l"; \
		tmux split-window -h -t $(TMUX_SESSION) -c $(DASHBOARD_DIR) "exec bash -l"; \
		tmux select-pane -t $(TMUX_SESSION):0.0; \
		tmux split-window -v -t $(TMUX_SESSION) "tail -f $(LOG_FILE); exec bash -l"; \
		tmux select-pane -t $(TMUX_SESSION):0.0; \
		sleep 2; \
		echo "✅ Dashboard started on port $(PORT)."; \
	elif ! tmux list-panes -t $(TMUX_SESSION):0 2>/dev/null | grep -q "^0:"; then \
		echo "⚠️  Session exists but is malformed. Recreating..."; \
		tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true; \
		$(MAKE) ensure; \
	elif [ "$$(tmux display-message -t $(TMUX_SESSION):0.0 -p '#{pane_dead}')" = "1" ]; then \
		echo "⚠️  Dashboard pane died. Respawning..."; \
		tmux respawn-pane -k -t $(TMUX_SESSION):0.0 -c $(DASHBOARD_DIR) \
			"node lib/server.js 2>&1 | tee -a $(LOG_FILE); echo '[Dashboard exited - shell ready]'; exec bash -l"; \
		echo "✅ Dashboard respawned."; \
	elif [ "$$(tmux display-message -t $(TMUX_SESSION):0.2 -p '#{pane_dead}')" = "1" ]; then \
		echo "⚠️  Logs pane died. Respawning..."; \
		tmux respawn-pane -k -t $(TMUX_SESSION):0.2 "tail -f $(LOG_FILE); exec bash -l"; \
		echo "✅ Logs pane respawned."; \
	else \
		echo "✅ Dashboard already running on port $(PORT)."; \
	fi

start: ensure ## Start dashboard in tmux (alias for ensure)

stop: ## Stop dashboard
	@if tmux has-session -t $(TMUX_SESSION) 2>/dev/null; then \
		echo "Stopping dashboard..."; \
		tmux send-keys -t $(TMUX_SESSION) C-c; \
		sleep 1; \
		tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true; \
		echo "✅ Dashboard stopped."; \
	else \
		echo "Dashboard not running."; \
	fi

restart: stop start ## Restart dashboard

status: ## Show dashboard status
	@echo "=== tmux session ==="
	@tmux has-session -t $(TMUX_SESSION) 2>/dev/null && echo "✅ Running" || echo "❌ Not running"
	@echo ""
	@echo "=== Port $(PORT) ==="
	@lsof -i :$(PORT) 2>/dev/null | head -5 || echo "Port $(PORT) not in use"
	@echo ""
	@echo "=== Recent logs ==="
	@tail -5 $(LOG_FILE) 2>/dev/null || echo "No logs"

logs: ## Tail dashboard logs
	@tail -f $(LOG_FILE)

attach: ## Attach to tmux session (Ctrl-B D to detach)
	@if ! tmux has-session -t $(TMUX_SESSION) 2>/dev/null; then \
		echo "Dashboard not running. Use 'make start' to start."; \
	elif [ -n "$$TMUX" ]; then \
		CURRENT=$$(tmux display-message -p '#S'); \
		if [ "$$CURRENT" = "$(TMUX_SESSION)" ]; then \
			echo "Already in $(TMUX_SESSION) session."; \
		else \
			tmux switch-client -t $(TMUX_SESSION); \
		fi \
	else \
		tmux attach -t $(TMUX_SESSION); \
	fi

clean: ## Stop dashboard and clean logs
	@$(MAKE) stop
	@echo "Cleaning logs..."
	@rm -f $(LOG_FILE)
	@echo "✅ Cleaned."

release: ## Create a release (usage: make release V=0.4.0)
ifndef V
	@echo "Usage: make release V=<version>"
	@echo "  e.g., make release V=0.4.0"
	@./scripts/release.sh --current
else
	@./scripts/release.sh $(V)
endif
