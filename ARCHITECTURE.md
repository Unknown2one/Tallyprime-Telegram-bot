# Architecture: Telegram Tally Bot

This document describes the high-level architecture of the Telegram Tally Bot, a multi-agent system designed to bridge WhatsApp communication with Tally Prime ERP.

## System Overview

The system is composed of three primary layers:

1.  **WhatsApp Interface (MCP Server):** A bridge to the WhatsApp network using `whatsmeow` and a custom MCP server. It handles incoming messages, media downloads (audio/images), and outgoing notifications.
2.  **Tally Prime Interface (MCP Server):** A specialized server that connects to Tally Prime's XML API. It uses `PgLite` for efficient in-memory caching of Tally reports and provides structured tools for querying ledgers, vouchers, and stock items.
3.  **Bot Orchestrator (Core Logic):** A Node.js application (using Telegraf) that integrates the MCP servers with Large Language Models (LLMs) to provide an intelligent, voice-and-text enabled interface for financial data.

## Key Components & Flows

### 1. Message Handling (`handleMessage`)
The central entry point in `src/bot.js`. It orchestrates:
-   **Audio Processing:** Transcribing voice notes using AI.
-   **Image Handling:** Extracting information from accounting screenshots.
-   **Intent Resolution:** Using LLMs to determine which Tally or WhatsApp tool to call.

### 2. Tool Routing (`routeToolCall`)
A modular routing system in `src/tools/router.js` that maps LLM-requested actions to specific MCP tool executions.

### 3. Tally Integration
-   **Data Access:** Uses structured XML templates to query Tally Prime.
-   **Caching:** Results are cached in a temporary PostgreSQL (PgLite) database to allow complex SQL analysis on top of Tally data.
-   **Voucher Generation:** Supports creating voucher drafts for approval.

### 4. WhatsApp Bridge
-   **Session Management:** Maintains WhatsApp sessions and message history in a local SQLite database (`drafts.db`).
-   **Media Handling:** A dedicated media bridge for downloading and converting WhatsApp audio/images.

## Technology Stack

-   **Runtime:** Node.js (Telegraf, LangChain)
-   **Database:** SQLite (Message tracking), PgLite (Tally caching)
-   **Communication:** Model Context Protocol (MCP)
-   **External APIs:** Tally Prime (XML), Sarvam AI (Speech), LLM Providers (OpenAI compatible)
-   **Infrastructure:** Nginx (Proxy), SSH Tunnels (Remote Tally access)

## Project Structure

-   `src/`: Core bot logic and service managers.
-   `src/tools/`: Domain-specific tool implementations (WhatsApp, Tally, Scheduler).
-   `tally-mcp-server/`: The standalone Tally MCP server.
-   `whatsapp-mcp/`: The standalone WhatsApp MCP server and Go bridge.
-   `tests/`: Unit and integration tests for all components.
-   `dashboard/`: A web-based UI for managing bot state and logs.
