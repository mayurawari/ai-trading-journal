"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIELDS, toRow, type TradeRow } from "@/core/fields";
import { DAILY_FIELDS, toDailyRow, type DailyReflectionRow, getNextEmptyDailyField } from "@/core/daily";
import { getNextMissingTradeField, applyTradeAnswer, applyDailyAnswer } from "@/core/questionnaire";
import type { ChatMessage } from "@/services/gemini/chat";

export interface ConnectionStatus {
  connected: boolean;
  email?: string;
  environment?: "real" | "test";
  sheet?: { url: string; trades: number | null; environment?: "real" | "test" } | null;
  realSheet?: { id: string | null; url: string | null };
  testSheet?: { id: string | null; url: string | null };
}

function readClientAuthHint(): ConnectionStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)ledgerstone_user=([^;]+)/);
    const email = match ? decodeURIComponent(match[1]).trim() : localStorage.getItem("ledgerstone_user_hint");
    if (email && email.includes("@")) {
      return { connected: true, email };
    }
  } catch {}
  return null;
}

interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  affectedAssets: string[];
  formattedTimeIST: string;
  formattedTimeEST: string;
  isPast: boolean;
}

const initialGreetingMessage: ChatMessage = {
  role: "assistant",
  content:
    "Welcome to Ledgerstone.\n" +
    "Every trade leaves a mark.\n\n" +
    "Describe your trades in natural language. You can enter one trade or multiple trades at once.\n" +
    "I will extract your positions, verify key parameters (Entry, Stop Loss, Target, Lot Size), complete your daily reflection, and record everything directly into your Google Sheet.\n\n" +
    "What trades did you take today?",
};

export default function JournalClient({ initialStatus }: { initialStatus?: ConnectionStatus }) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(
    initialStatus ?? null,
  );
  const [isInitializing, setIsInitializing] = useState(initialStatus ? false : true);
  const [conversationMessages, setConversationMessages] = useState<ChatMessage[]>([initialGreetingMessage]);
  const [activeTrades, setActiveTrades] = useState<TradeRow[]>([]);
  const [dailyReflectionAnswers, setDailyReflectionAnswers] = useState<DailyReflectionRow>({});
  const [suggestedOptionReplies, setSuggestedOptionReplies] = useState<string[]>([]);
  const [workflowStage, setWorkflowStage] = useState<"collecting_trades" | "daily_questions" | "ready_to_save" | "saved">("collecting_trades");
  const [userChatInput, setUserChatInput] = useState("");
  const [isProcessingRequest, setIsProcessingRequest] = useState(false);
  const [isSavingToSheet, setIsSavingToSheet] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [journalSpreadsheetUrl, setJournalSpreadsheetUrl] = useState<string | null>(
    initialStatus?.sheet?.url ?? null,
  );
  const [activeJournalMode, setActiveJournalMode] = useState<"real" | "test">(
    initialStatus?.connected ? (initialStatus.environment || "real") : "test",
  );
  const [isSwitchingJournalMode, setIsSwitchingJournalMode] = useState(false);
  const [switchingTargetMode, setSwitchingTargetMode] = useState<"real" | "test" | null>(null);

  const [isDemoModeEnabled, setIsDemoModeEnabled] = useState(false);
  const [isDemoViewerOpen, setIsDemoViewerOpen] = useState(false);
  const [demoTradesList, setDemoTradesList] = useState<TradeRow[]>([]);
  const [demoDailyList, setDemoDailyList] = useState<DailyReflectionRow[]>([]);
  const [demoViewerTab, setDemoViewerTab] = useState<"trades" | "daily">("trades");

  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [upcomingEconomicEvents, setUpcomingEconomicEvents] = useState<EconomicEvent[]>([]);

  const chatContainerEndRef = useRef<HTMLDivElement>(null);
  const chatInputTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const isSaveInProgressRef = useRef(false);

  const handleExportDemoCSV = useCallback((type: "trades" | "daily" = "trades") => {
    if (typeof window === "undefined") return;
    if (type === "trades") {
      if (demoTradesList.length === 0) {
        setErrorMessage("No demo trades to export yet.");
        return;
      }
      const headers = FIELDS.map((f) => `"${f.header.replace(/"/g, '""')}"`).join(",");
      const rows = demoTradesList.map((trade) => {
        const rowVals = toRow(trade, FIELDS.map((f) => f.header));
        return rowVals
          .map((val) => {
            const str = val == null ? "" : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(",");
      });
      const csvData = "data:text/csv;charset=utf-8," + encodeURIComponent([headers, ...rows].join("\n"));
      const link = document.createElement("a");
      link.setAttribute("href", csvData);
      link.setAttribute("download", `ledgerstone-demo-trades-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      if (demoDailyList.length === 0) {
        setErrorMessage("No demo reflections to export yet.");
        return;
      }
      const headers = DAILY_FIELDS.map((f) => `"${f.header.replace(/"/g, '""')}"`).join(",");
      const rows = demoDailyList.map((daily) => {
        const rowVals = toDailyRow(daily, DAILY_FIELDS.map((f) => f.header));
        return rowVals
          .map((val) => {
            const str = val == null ? "" : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(",");
      });
      const csvData = "data:text/csv;charset=utf-8," + encodeURIComponent([headers, ...rows].join("\n"));
      const link = document.createElement("a");
      link.setAttribute("href", csvData);
      link.setAttribute("download", `ledgerstone-demo-daily-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [demoTradesList, demoDailyList]);

  const fetchConnectionStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/status");
      const statusPayload = await response.json();
      setConnectionStatus(statusPayload);
      if (typeof window !== "undefined") {
        if (statusPayload.connected && statusPayload.email) {
          setIsDemoModeEnabled(false);
          try {
            localStorage.setItem("ledgerstone_user_hint", statusPayload.email);
            localStorage.removeItem("ledgerstone_demo_active");
          } catch {}
        } else if (!statusPayload.connected) {
          try {
            localStorage.removeItem("ledgerstone_user_hint");
          } catch {}
        }
      }
      if (statusPayload.environment) {
        setActiveJournalMode(statusPayload.environment);
      }
      if (statusPayload.sheet?.url) {
        setJournalSpreadsheetUrl(statusPayload.sheet.url);
      }
    } catch {
      setConnectionStatus({ connected: false });
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const handleSwitchJournalMode = async (targetMode: "real" | "test") => {
    if (isSwitchingJournalMode || activeJournalMode === targetMode) return;
    setIsSwitchingJournalMode(true);
    setSwitchingTargetMode(targetMode);
    setErrorMessage(null);

    if (targetMode === "test") {
      setActiveJournalMode("test");
      setIsDemoModeEnabled(true);
      try {
        localStorage.setItem("ledgerstone_demo_active", "true");
      } catch {}
      setJournalSpreadsheetUrl("#demo-sheet");
      try {
        await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "test" }),
        });
      } catch {}
      setIsSwitchingJournalMode(false);
      setSwitchingTargetMode(null);
      return;
    }

    if (targetMode === "real") {
      if (!connectionStatus?.connected) {
        setErrorMessage("Live Journal requires connecting your Google Drive. Click 'Connect Google' in the top bar to authenticate.");
        setIsSwitchingJournalMode(false);
        setSwitchingTargetMode(null);
        return;
      }
      try {
        const response = await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "real" }),
        });
        const data = await response.json();
        if (data.ok) {
          setActiveJournalMode("real");
          setConnectionStatus(data);
          try {
            localStorage.removeItem("ledgerstone_demo_active");
          } catch {}
          if (data.sheet?.url) {
            setJournalSpreadsheetUrl(data.sheet.url);
          }
        } else {
          setErrorMessage(data.error || "Failed to switch journal environment.");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to switch environment";
        setErrorMessage(errorMsg);
      } finally {
        setIsSwitchingJournalMode(false);
        setSwitchingTargetMode(null);
      }
    }
  };

  const fetchMarketEconomicNews = useCallback(async () => {
    try {
      const response = await fetch("/api/news");
      const newsPayload = await response.json();
      if (newsPayload.ok && Array.isArray(newsPayload.events)) {
        setUpcomingEconomicEvents(newsPayload.events);
      }
    } catch {
      setUpcomingEconomicEvents([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarVisible(false);
    }
  }, []);

  // Hydrate session and demo state from localStorage on initial client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const justConnected = searchParams.get("connected") === "1";
      const isDemoParam = searchParams.get("mode") === "demo" || searchParams.get("demo") === "true";

      if (justConnected) {
        try {
          localStorage.removeItem("ledgerstone_demo_active");
        } catch {}
      }

      const isDemoSaved = localStorage.getItem("ledgerstone_demo_active") === "true";
      const isConnected = Boolean(initialStatus?.connected);

      // Only enter demo sandbox if explicitly requested via query param OR if saved and NOT logged in
      if (isDemoParam || (isDemoSaved && !isConnected)) {
        setIsDemoModeEnabled(true);
        setActiveJournalMode("test");
        setJournalSpreadsheetUrl("#demo-sheet");
      } else if (isConnected && !isDemoParam) {
        setIsDemoModeEnabled(false);
        setActiveJournalMode(initialStatus?.environment || "real");
        if (initialStatus?.sheet?.url) {
          setJournalSpreadsheetUrl(initialStatus.sheet.url);
        }
      }
      try {
        const rawTrades = localStorage.getItem("ledgerstone_demo_trades");
        if (rawTrades) {
          const parsedTrades = JSON.parse(rawTrades);
          if (Array.isArray(parsedTrades)) setDemoTradesList(parsedTrades);
        }
        const rawDaily = localStorage.getItem("ledgerstone_demo_daily");
        if (rawDaily) {
          const parsedDaily = JSON.parse(rawDaily);
          if (Array.isArray(parsedDaily)) setDemoDailyList(parsedDaily);
        }
      } catch {}
    }

    try {
      const saved = localStorage.getItem("ledgerstone_session_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.activeTrades) && parsed.activeTrades.length > 0) {
          setActiveTrades(parsed.activeTrades);
        }
        if (parsed.dailyAnswers && typeof parsed.dailyAnswers === "object") {
          setDailyReflectionAnswers(parsed.dailyAnswers);
        }
        if (Array.isArray(parsed.messages) && parsed.messages.length > 1) {
          setConversationMessages(parsed.messages);
        }
        if (Array.isArray(parsed.suggestedReplies)) {
          setSuggestedOptionReplies(parsed.suggestedReplies);
        }
        if (parsed.workflowStage) {
          setWorkflowStage(parsed.workflowStage);
        }
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Sync state changes to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (workflowStage === "saved") {
        localStorage.removeItem("ledgerstone_session_v2");
      } else if (activeTrades.length > 0 || Object.keys(dailyReflectionAnswers).length > 0) {
        localStorage.setItem(
          "ledgerstone_session_v2",
          JSON.stringify({
            activeTrades,
            dailyAnswers: dailyReflectionAnswers,
            messages: conversationMessages,
            suggestedReplies: suggestedOptionReplies,
            workflowStage,
          }),
        );
      }
    } catch {
      // localStorage quota exceeded or disabled
    }
  }, [activeTrades, dailyReflectionAnswers, conversationMessages, suggestedOptionReplies, workflowStage]);

  useEffect(() => {
    const urlSearchParameters = new URLSearchParams(window.location.search);
    const authenticationError = urlSearchParameters.get("error");
    const justConnected = urlSearchParameters.get("connected") === "1";

    if (justConnected) {
      try {
        localStorage.removeItem("ledgerstone_demo_active");
      } catch {}
      setIsDemoModeEnabled(false);
      setActiveJournalMode("real");
    }

    if (!initialStatus?.connected) {
      const hint = readClientAuthHint();
      if (hint) {
        setConnectionStatus(hint);
        setIsInitializing(false);
      }
    }
    if (authenticationError) {
      setErrorMessage(authenticationError);
    }
    if (authenticationError || justConnected) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    void fetchConnectionStatus();
    void fetchMarketEconomicNews();
  }, [fetchConnectionStatus, fetchMarketEconomicNews, initialStatus]);

  useEffect(() => {
    chatContainerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationMessages, isProcessingRequest, suggestedOptionReplies]);

  async function handleSendUserMessage(explicitTextToSend?: string) {
    const textContent = (explicitTextToSend ?? userChatInput).trim();
    if (!textContent || isProcessingRequest || isSavingToSheet || isSaveInProgressRef.current) return;

    if (textContent === "Journal more trades" || textContent === "New session") {
      handleRestartJournalSession();
      return;
    }

    if (textContent === "Open Sheet" || textContent === "View Demo Sheet" || textContent === "Demo Sheet") {
      if (journalSpreadsheetUrl === "#demo-sheet" || !connectionStatus?.connected || activeJournalMode === "test" || textContent.includes("Demo")) {
        setIsDemoViewerOpen(true);
      } else if (journalSpreadsheetUrl) {
        window.open(journalSpreadsheetUrl, "_blank");
      }
      return;
    }

    if (textContent === "Download CSV") {
      handleExportDemoCSV(demoViewerTab);
      return;
    }

    if (textContent === "Connect with Google" || textContent === "Connect Google Account") {
      window.location.href = "/api/auth/google";
      return;
    }

    if (textContent === "Save to Demo Sandbox" || textContent === "Save to Demo Sheet") {
      setActiveJournalMode("test");
      setIsDemoModeEnabled(true);
      try {
        localStorage.setItem("ledgerstone_demo_active", "true");
      } catch {}
      void handleSavePositionsToSpreadsheet();
      return;
    }

    if (textContent === "Save trades now" || textContent === "Retry save" || textContent === "Save to Sheet") {
      if (workflowStage === "saved") {
        setConversationMessages((previous) => [
          ...previous,
          { role: "user", content: textContent },
          {
            role: "assistant",
            content:
              activeJournalMode === "test" || !connectionStatus?.connected
                ? "Your trades are saved in your local Demo Sheet. Tap Start New Session to record new entries, or View Demo Sheet to inspect."
                : "Your trades are already saved in your Google Sheet. Tap Start New Session to record new entries.",
          },
        ]);
        setSuggestedOptionReplies(
          activeJournalMode === "test" || !connectionStatus?.connected
            ? ["Journal more trades", "View Demo Sheet", "Download CSV"]
            : ["Journal more trades", "Open Sheet"]
        );
        return;
      }
      void handleSavePositionsToSpreadsheet();
      return;
    }

    if (textContent === "Retry") {
      const lastUserEntry = [...conversationMessages].reverse().find((m) => m.role === "user");
      if (lastUserEntry) {
        void handleSendUserMessage(lastUserEntry.content);
        return;
      }
    }

    // Check if this is a new trade entry description (requires LLM parsing)
    const isNewTradeDeclaration =
      /\b(buy|bought|long|longed|sell|sold|short|shorted)\b/i.test(textContent) &&
      /\b(lots?|contracts?|at\s+\d|\d{3,})\b/i.test(textContent);

    // High-speed local progression: Answering a missing trade field (0ms latency, zero API calls)
    if (activeTrades.length > 0 && workflowStage === "collecting_trades" && !isNewTradeDeclaration) {
      const missingTrade = getNextMissingTradeField(activeTrades);
      if (missingTrade) {
        const updatedTrades = [...activeTrades];
        updatedTrades[missingTrade.tradeIndex] = applyTradeAnswer(
          updatedTrades[missingTrade.tradeIndex],
          missingTrade.field,
          textContent,
        );
        setActiveTrades(updatedTrades);

        const nextMissing = getNextMissingTradeField(updatedTrades);
        let nextMsg = "";
        let nextOptions: string[] = [];
        let nextStage: "collecting_trades" | "daily_questions" | "ready_to_save" = "collecting_trades";

        if (nextMissing) {
          nextMsg = nextMissing.question;
          nextOptions = nextMissing.options;
          nextStage = "collecting_trades";
        } else {
          const nextDaily = getNextEmptyDailyField(dailyReflectionAnswers);
          if (nextDaily) {
            nextMsg = `**Daily Reflection (${nextDaily.stepNumber}/${nextDaily.totalSteps}): ${nextDaily.header}**\n\n${nextDaily.question}`;
            nextOptions = nextDaily.options;
            nextStage = "daily_questions";
          } else {
            if (activeJournalMode === "test" || !connectionStatus?.connected) {
              nextMsg =
                "All trade and daily reflection details are verified and complete.\n\n" +
                "Tap **Save to Demo Sheet** below to record directly to your local Demo Sandbox.";
              nextOptions = ["Save trades now", "View Demo Sheet"];
            } else {
              nextMsg =
                "All trade and daily reflection details are verified and complete.\n\n" +
                "Tap **Save to Sheet** below to record directly to your Google Sheet.";
              nextOptions = ["Save trades now", "Open Sheet"];
            }
            nextStage = "ready_to_save";
          }
        }

        setUserChatInput("");
        setConversationMessages((prev) => [
          ...prev,
          { role: "user", content: textContent },
          { role: "assistant", content: nextMsg },
        ]);
        setSuggestedOptionReplies(nextOptions);
        setWorkflowStage(nextStage);
        setTimeout(() => chatInputTextAreaRef.current?.focus(), 50);
        return;
      }
    }

    // High-speed local progression: Answering a daily reflection question (0ms latency, zero API calls)
    if (activeTrades.length > 0 && workflowStage === "daily_questions" && !isNewTradeDeclaration) {
      const nextDaily = getNextEmptyDailyField(dailyReflectionAnswers);
      if (nextDaily) {
        const updatedDaily = applyDailyAnswer(dailyReflectionAnswers, nextDaily.key, textContent);
        setDailyReflectionAnswers(updatedDaily);

        const followingDaily = getNextEmptyDailyField(updatedDaily);
        let nextMsg = "";
        let nextOptions: string[] = [];
        let nextStage: "daily_questions" | "ready_to_save" = "daily_questions";

        if (followingDaily) {
          nextMsg = `**Daily Reflection (${followingDaily.stepNumber}/${followingDaily.totalSteps}): ${followingDaily.header}**\n\n${followingDaily.question}`;
          nextOptions = followingDaily.options;
          nextStage = "daily_questions";
        } else {
          if (activeJournalMode === "test" || !connectionStatus?.connected) {
            nextMsg =
              "All trade and daily reflection details are verified and complete.\n\n" +
              "Tap **Save to Demo Sheet** below to record directly to your local Demo Sandbox.";
            nextOptions = ["Save trades now", "View Demo Sheet"];
          } else {
            nextMsg =
              "All trade and daily reflection details are verified and complete.\n\n" +
              "Tap **Save to Sheet** below to record directly to your Google Sheet.";
            nextOptions = ["Save trades now", "Open Sheet"];
          }
          nextStage = "ready_to_save";
        }

        setUserChatInput("");
        setConversationMessages((prev) => [
          ...prev,
          { role: "user", content: textContent },
          { role: "assistant", content: nextMsg },
        ]);
        setSuggestedOptionReplies(nextOptions);
        setWorkflowStage(nextStage);
        setTimeout(() => chatInputTextAreaRef.current?.focus(), 50);
        return;
      }
    }

    // Natural Language / Initial Turn: Process with AI
    setUserChatInput("");
    setErrorMessage(null);

    const updatedMessageHistory: ChatMessage[] = [...conversationMessages, { role: "user", content: textContent }];
    setConversationMessages(updatedMessageHistory);
    setIsProcessingRequest(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessageHistory,
          currentTrades: activeTrades,
          dailyAnswers: dailyReflectionAnswers,
          mode: activeJournalMode,
        }),
      });

      const responseData = await response.json();
      if (!responseData.ok) {
        const failureDetails = responseData.error || "Failed to process trading dialogue.";
        setErrorMessage(failureDetails);
        const isAuthNotice = response.status === 401 || failureDetails.toLowerCase().includes("not connected");
        setConversationMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: isAuthNotice
              ? `Notice: ${failureDetails}\n\nYour trade details are saved in this session. Tap Connect with Google to authorize sync, or Save to Demo Sandbox.`
              : `Notice: ${failureDetails}\n\nYour trade details are saved in this session. Tap Save trades now or Retry below.`,
          },
        ]);
        setSuggestedOptionReplies(
          isAuthNotice
            ? ["Connect with Google", "Save to Demo Sandbox", "Retry"]
            : ["Save trades now", "Retry"]
        );
        setIsProcessingRequest(false);
        return;
      }

      setConversationMessages((previous) => [...previous, { role: "assistant", content: responseData.assistantMessage }]);
      if (Array.isArray(responseData.trades)) setActiveTrades(responseData.trades);
      if (responseData.daily) setDailyReflectionAnswers(responseData.daily);
      if (Array.isArray(responseData.suggestedReplies)) setSuggestedOptionReplies(responseData.suggestedReplies);
      if (responseData.stage) setWorkflowStage(responseData.stage);
      if (responseData.url) setJournalSpreadsheetUrl(responseData.url);

      if (responseData.stage === "saved") {
        void fetchConnectionStatus();
      }
    } catch (networkError) {
      const errorText = networkError instanceof Error ? networkError.message : "Network failure";
      setErrorMessage(`Could not communicate with the server (${errorText}).`);
      setConversationMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `Connection interrupted: Could not reach the server (${errorText}). Tap Retry or Save trades now below.`,
        },
      ]);
      setSuggestedOptionReplies(["Save trades now", "Retry"]);
    } finally {
      setIsProcessingRequest(false);
      setTimeout(() => chatInputTextAreaRef.current?.focus(), 50);
    }
  }

  async function handleSavePositionsToSpreadsheet() {
    if (activeTrades.length === 0 || isSavingToSheet || isSaveInProgressRef.current || workflowStage === "saved") {
      return;
    }
    isSaveInProgressRef.current = true;
    setIsSavingToSheet(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationMessages,
          currentTrades: activeTrades,
          dailyAnswers: dailyReflectionAnswers,
          forceSave: true,
          mode: activeJournalMode,
        }),
      });

      const responseData = await response.json();
      if (!responseData.ok) {
        const failureDetails = responseData.error || "Save operation failed.";
        setErrorMessage(failureDetails);
        const isAuthNotice = response.status === 401 || failureDetails.toLowerCase().includes("not connected");
        setConversationMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: isAuthNotice
              ? `Google Sheets notice: ${failureDetails}\n\nYour trades are intact. Tap Connect with Google to authorize your sheet, or tap Save to Demo Sandbox to record them locally right now.`
              : `Save notice: ${failureDetails}\n\nTap Retry save to try recording to Google Sheets again.`,
          },
        ]);
        setSuggestedOptionReplies(
          isAuthNotice
            ? ["Connect with Google", "Save to Demo Sandbox", "Download CSV"]
            : ["Retry save", "Open Sheet"]
        );
        return;
      }

      if (responseData.isDemo || responseData.demoLocal || activeJournalMode === "test" || !connectionStatus?.connected) {
        try {
          const rawExisting = localStorage.getItem("ledgerstone_demo_trades");
          const existingTrades: TradeRow[] = rawExisting ? JSON.parse(rawExisting) : [];
          const tradesToAdd: TradeRow[] = Array.isArray(responseData.trades) && responseData.trades.length > 0
            ? responseData.trades
            : activeTrades;
          const mergedTrades = [...existingTrades, ...tradesToAdd];
          localStorage.setItem("ledgerstone_demo_trades", JSON.stringify(mergedTrades));
          setDemoTradesList(mergedTrades);

          if (responseData.daily || Object.keys(dailyReflectionAnswers).length > 0) {
            const rawDaily = localStorage.getItem("ledgerstone_demo_daily");
            const existingDaily: DailyReflectionRow[] = rawDaily ? JSON.parse(rawDaily) : [];
            const dailyToAdd: DailyReflectionRow = (responseData.daily && Object.keys(responseData.daily).length > 0)
              ? responseData.daily
              : dailyReflectionAnswers;
            const mergedDaily = [...existingDaily, dailyToAdd];
            localStorage.setItem("ledgerstone_demo_daily", JSON.stringify(mergedDaily));
            setDemoDailyList(mergedDaily);
          }
        } catch (e) {
          console.error("Failed to save to local demo storage", e);
        }
      }

      try {
        localStorage.removeItem("ledgerstone_session_v2");
      } catch {}

      setConversationMessages((previous) => [...previous, { role: "assistant", content: responseData.assistantMessage }]);
      setWorkflowStage("saved");

      if (responseData.isDemo || !connectionStatus?.connected || activeJournalMode === "test") {
        setSuggestedOptionReplies(["Journal more trades", "View Demo Sheet", "Download CSV"]);
        setJournalSpreadsheetUrl("#demo-sheet");
      } else {
        setSuggestedOptionReplies(["Journal more trades", "Open Sheet"]);
        if (responseData.url) setJournalSpreadsheetUrl(responseData.url);
      }
      void fetchConnectionStatus();
    } catch (networkError) {
      const errorText = networkError instanceof Error ? networkError.message : "Network failure";
      setErrorMessage(`Failed to record trades to Google Sheets (${errorText}).`);
      setConversationMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `Network error during save: Could not reach Google Sheets. Tap Retry save to try again.`,
        },
      ]);
      setSuggestedOptionReplies(["Retry save"]);
    } finally {
      setIsSavingToSheet(false);
      isSaveInProgressRef.current = false;
    }
  }

  function handleRestartJournalSession() {
    try {
      localStorage.removeItem("ledgerstone_session_v2");
    } catch {}
    setConversationMessages([initialGreetingMessage]);
    setActiveTrades([]);
    setDailyReflectionAnswers({});
    setSuggestedOptionReplies([]);
    setWorkflowStage("collecting_trades");
    setErrorMessage(null);
    setUserChatInput("");
  }

  async function handleSignOutUser() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setConnectionStatus({ connected: false });
      setIsDemoModeEnabled(false);
      try {
        localStorage.removeItem("ledgerstone_demo_active");
        localStorage.removeItem("ledgerstone_user_hint");
      } catch {}
      handleRestartJournalSession();
    }
  }

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f1f0ea] font-body">
        <div className="rounded-lg border border-[#e0ddcf] bg-[#f1f0ea] px-6 py-4 shadow-sm">
          <span className="font-heading text-xs font-semibold uppercase tracking-wider text-[#2d232e]">
            Loading Trading Journal...
          </span>
        </div>
      </div>
    );
  }

  if (!connectionStatus?.connected && !isDemoModeEnabled) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f1f0ea] px-4 py-12 font-body text-[#2d232e]">
        <div className="w-full max-w-md rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-6 sm:p-8 shadow-xs text-center">
          <div className="mx-auto mb-4 relative inline-block">
            <div className="relative size-16 sm:size-20 rounded-2xl border-2 border-[#2d232e] overflow-hidden bg-[#2d232e] shadow-md animate-terminal-halo">
              <img src="/icon.jpg" alt="Ledgerstone Logo" className="size-full object-cover" />
              <div className="pointer-events-none absolute -inset-full w-[200%] h-[200%] bg-gradient-to-r from-transparent via-[#f1f0ea]/25 to-transparent animate-live-sheen" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex size-3.5 sm:size-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0ddcf] opacity-75"></span>
              <span className="relative inline-flex size-3.5 sm:size-4 rounded-full border-2 border-[#f1f0ea] bg-[#2d232e]"></span>
            </span>
          </div>

          <h1 className="font-heading mb-1 text-3xl font-bold tracking-tight text-[#2d232e]">
            Ledgerstone
          </h1>
          <p className="font-heading mb-6 text-xs font-bold tracking-widest uppercase text-[#534b52]">
            Every trade leaves a mark.
          </p>

          {errorMessage && (
            <div className="mb-6 rounded-md border-2 border-[#2d232e] bg-[#e0ddcf] p-3 text-xs font-semibold text-[#2d232e]">
              {errorMessage}
            </div>
          )}

          <p className="mb-6 text-xs leading-relaxed text-[#534b52]">
            Connect your Google account to log entries directly into your sovereign Google Sheet, or jump straight into the Demo Sandbox with zero login required.
          </p>

          <a
            href="/api/auth/google"
            className="font-heading inline-flex w-full items-center justify-center rounded-lg bg-[#2d232e] px-5 py-3 text-sm font-bold text-[#f1f0ea] shadow-xs transition hover:bg-[#474448] active:scale-98"
          >
            Continue with Google &rarr;
          </a>

          <button
            type="button"
            onClick={() => {
              setIsDemoModeEnabled(true);
              setActiveJournalMode("test");
              setJournalSpreadsheetUrl("#demo-sheet");
              try {
                localStorage.setItem("ledgerstone_demo_active", "true");
              } catch {}
            }}
            className="font-heading mt-2.5 inline-flex w-full items-center justify-center rounded-lg border-2 border-[#2d232e] bg-[#e0ddcf] px-5 py-2.5 text-xs font-bold text-[#2d232e] transition hover:bg-[#2d232e] hover:text-[#f1f0ea] active:scale-98 cursor-pointer"
          >
            ▲ Try Demo Sandbox (No Login Required) &rarr;
          </button>

          <a
            href="/"
            className="font-heading mt-2 inline-flex w-full items-center justify-center rounded-lg border border-[#534b52]/40 bg-transparent px-5 py-2 text-xs font-medium text-[#534b52] transition hover:text-[#2d232e] hover:bg-[#e0ddcf]/50 active:scale-98"
          >
            &larr; Back to Homepage
          </a>

          <div className="mt-6 border-t border-[#e0ddcf] pt-5 text-xs text-[#534b52]">
            <span>Demo Mode is 100% sovereign & local. No trades or accounts stored on external servers.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen h-[100dvh] w-full overflow-hidden bg-[#f1f0ea] font-body text-[#2d232e] relative">
      {/* Mobile Drawer Backdrop */}
      {isSidebarVisible && (
        <div
          onClick={() => setIsSidebarVisible(false)}
          className="fixed inset-0 z-40 bg-[#2d232e]/60 backdrop-blur-xs transition-opacity lg:hidden"
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar: In-flow column on desktop (lg:), slide-over drawer on mobile/tablet */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[85vw] max-w-xs sm:w-88 sm:max-w-sm flex-col border-r-2 border-[#2d232e] bg-[#e0ddcf] shadow-2xl transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:h-full lg:w-84 xl:w-92 lg:shadow-none lg:transition-none ${isSidebarVisible ? "translate-x-0" : "-translate-x-full lg:hidden"
          }`}
      >
        <div className="border-b-2 border-[#2d232e] bg-[#f1f0ea] p-4 flex-shrink-0 space-y-3">
          {/* Top Brand Identity Row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="relative size-9 rounded-lg border-2 border-[#2d232e] overflow-hidden bg-[#2d232e] shadow-xs animate-terminal-halo">
                  <img
                    src="/icon.jpg"
                    alt="Ledgerstone Logo"
                    className="size-full object-cover transition-transform duration-300 hover:scale-105"
                  />
                  <div className="pointer-events-none absolute -inset-full w-[200%] h-[200%] bg-gradient-to-r from-transparent via-[#f1f0ea]/20 to-transparent animate-live-sheen" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5" title="Live Terminal Active">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0ddcf] opacity-75"></span>
                  <span className="relative inline-flex size-2.5 rounded-full border border-[#f1f0ea] bg-[#2d232e]"></span>
                </span>
              </div>
              <div className="min-w-0">
                <h1 className="font-heading text-lg font-bold tracking-tight text-[#2d232e] leading-tight">
                  Ledgerstone
                </h1>
                <p className="font-body text-[11px] text-[#534b52] truncate">
                  Every trade leaves a mark.
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsSidebarVisible(false)}
              className="font-heading flex size-7 items-center justify-center rounded-lg border border-[#534b52]/30 bg-[#e0ddcf]/50 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95 flex-shrink-0 cursor-pointer"
              title="Collapse Sidebar"
              aria-label="Collapse Sidebar"
            >
              &lt;
            </button>
          </div>

          {/* Dedicated Navigation & Utility Strip */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e0ddcf]">
            <a
              href="/"
              className="font-heading inline-flex items-center gap-1.5 rounded-lg border border-[#534b52]/30 bg-[#f1f0ea] px-3 py-1.5 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95 shadow-2xs"
              title="Return to Homepage"
            >
              <span>&larr;</span>
              <span>Home</span>
            </a>

            {!connectionStatus?.connected ? (
              <a
                href="/api/auth/google"
                className="font-heading inline-flex items-center gap-1 rounded-lg bg-[#2d232e] px-3 py-1.5 text-xs font-bold text-[#f1f0ea] hover:bg-[#474448] transition active:scale-95 shadow-2xs"
              >
                <span>Connect Google</span>
              </a>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-heading truncate max-w-[100px] rounded-md border border-[#534b52]/30 bg-[#e0ddcf] px-2 py-1 text-[11px] font-semibold text-[#2d232e]">
                  {connectionStatus.email?.split("@")[0]}
                </span>
                <button
                  onClick={handleSignOutUser}
                  className="font-heading rounded-lg border border-[#534b52]/30 px-2 py-1 text-xs font-semibold text-[#534b52] hover:text-[#2d232e] hover:bg-[#e0ddcf] transition active:scale-95 cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 sm:space-y-4">
          {/* ── 1. Primary Card: Journal Storage & Environment Switcher ──── */}
          <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e]">
                Journal Storage
              </span>
              <span className="font-heading rounded border border-[#534b52]/40 bg-[#e0ddcf]/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2d232e]">
                {activeJournalMode === "real" ? "● Live / Real" : "▲ Demo / Test"}
              </span>
            </div>

            {/* Institutional Segmented Control for Real vs Demo Sheet */}
            <div className="mb-3 p-1 rounded-lg border-2 border-[#2d232e] bg-[#e0ddcf]/60">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => handleSwitchJournalMode("real")}
                  disabled={isSwitchingJournalMode}
                  title="Switch to Real / Live Trading Journal"
                  className={`font-heading text-xs font-bold py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-60 cursor-pointer ${
                    activeJournalMode === "real"
                      ? "bg-[#2d232e] text-[#f1f0ea] shadow-xs"
                      : "text-[#534b52] hover:text-[#2d232e] hover:bg-[#e0ddcf]"
                  }`}
                >
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      activeJournalMode === "real" ? "bg-[#e0ddcf]" : "bg-[#534b52]"
                    }`}
                  />
                  <span>Real Journal</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchJournalMode("test")}
                  disabled={isSwitchingJournalMode}
                  title="Switch to Demo & Testing Journal"
                  className={`font-heading text-xs font-bold py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-60 cursor-pointer ${
                    activeJournalMode === "test"
                      ? "bg-[#2d232e] text-[#f1f0ea] shadow-xs"
                      : "text-[#534b52] hover:text-[#2d232e] hover:bg-[#e0ddcf]"
                  }`}
                >
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      activeJournalMode === "test" ? "bg-[#e0ddcf]" : "bg-[#534b52]"
                    }`}
                  />
                  <span>Demo / Test</span>
                </button>
              </div>
            </div>

            {/* Target Sheet Mode Description Card */}
            <div className="rounded-md border border-[#534b52]/30 bg-[#e0ddcf]/40 p-2.5 mb-3 text-[11px] text-[#534b52]">
              <div className="flex items-center justify-between font-medium">
                <span className="text-[#474448]">Active Target:</span>
                <span className="font-heading font-bold text-[#2d232e] truncate max-w-[140px]">
                  {activeJournalMode === "real" ? "Live Trading Log" : "Demo Sandbox"}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#534b52]">
                {activeJournalMode === "real"
                  ? "Logs directly to your primary real trading Google Sheet."
                  : "Safe browser sandbox for testing. Zero login required."}
              </p>
            </div>

            {activeJournalMode === "test" || !connectionStatus?.connected || journalSpreadsheetUrl === "#demo-sheet" ? (
              <div className="space-y-2 mb-3">
                <button
                  type="button"
                  onClick={() => setIsDemoViewerOpen(true)}
                  className="font-heading w-full flex items-center justify-between rounded-md border-2 border-[#2d232e] bg-[#f1f0ea] px-3 py-2 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition shadow-xs cursor-pointer"
                >
                  <span>Open Demo Sheet Vault</span>
                  <span className="font-heading rounded bg-[#e0ddcf] border border-[#534b52] px-1.5 py-0.5 text-[10px] font-bold text-[#2d232e]">
                    {demoTradesList.length} trades
                  </span>
                </button>
                {demoTradesList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleExportDemoCSV("trades")}
                    className="font-heading w-full flex items-center justify-center rounded-md border border-[#534b52]/40 bg-[#e0ddcf] px-2.5 py-1.5 text-[11px] font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition cursor-pointer"
                  >
                    Download Demo CSV
                  </button>
                )}
              </div>
            ) : journalSpreadsheetUrl ? (
              <a
                href={journalSpreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="font-heading mb-3 flex items-center justify-between rounded-md border-2 border-[#2d232e] bg-[#f1f0ea] px-3 py-2 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition shadow-xs"
              >
                <span>
                  {isSwitchingJournalMode ? "Switching Sheet..." : "Open Real Sheet"}
                </span>
                {connectionStatus?.sheet?.trades != null && (
                  <span className="font-heading rounded bg-[#e0ddcf] border border-[#534b52] px-1.5 py-0.5 text-[10px] font-bold text-[#2d232e]">
                    {connectionStatus.sheet.trades} trades
                  </span>
                )}
              </a>
            ) : (
              <div className="text-xs text-[#534b52] mb-3">
                Google Sheet will be generated automatically upon your first saved trade.
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-[#534b52] mb-3">
              <span>Current Session:</span>
              <span className="font-bold text-[#2d232e]">{activeTrades.length} trade{activeTrades.length === 1 ? "" : "s"} identified</span>
            </div>

            <button
              onClick={() => {
                handleRestartJournalSession();
                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                  setIsSidebarVisible(false);
                }
              }}
              className="font-heading w-full rounded-md border border-[#534b52] bg-[#f1f0ea] py-2 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition text-center cursor-pointer shadow-2xs"
            >
              Start New Session
            </button>
          </div>

          {/* ── 2. Secondary Card: News Alerts / Macro Radar ─────────────── */}
          <div className="rounded-xl border border-[#534b52]/30 bg-[#f1f0ea] p-4 shadow-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e]">
                News Alerts
              </span>
              <span className="rounded bg-[#2d232e] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#f1f0ea]">
                Active
              </span>
            </div>
            <p className="text-xs text-[#534b52] mb-3 leading-relaxed">
              Automated alerts monitor CPI, FOMC, and NFP releases 24 hours and 60 minutes prior to impact.
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {upcomingEconomicEvents.length > 0 ? (
                upcomingEconomicEvents.map((eventItem) => (
                  <div
                    key={eventItem.id}
                    className="rounded-md border border-[#e0ddcf] bg-[#f1f0ea] p-2.5 text-xs hover:border-[#2d232e] transition"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-heading rounded bg-[#2d232e] px-1.5 py-0.5 text-[9px] font-bold text-[#f1f0ea] uppercase">
                          {eventItem.country}
                        </span>
                        <span className="font-heading font-semibold text-[#2d232e] truncate text-xs">
                          {eventItem.title}
                        </span>
                      </div>
                      <span className="font-heading font-bold text-[#474448] text-xs flex-shrink-0">
                        {eventItem.formattedTimeIST} IST
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#534b52]">
                      <span>
                        Exp: <strong className="text-[#2d232e]">{eventItem.forecast}</strong> | Prev: <strong className="text-[#2d232e]">{eventItem.previous}</strong>
                      </span>
                      <span className="rounded border border-[#534b52]/30 bg-[#e0ddcf]/50 px-1.5 py-0.5 text-[10px] font-medium text-[#2d232e]">
                        {eventItem.affectedAssets.slice(0, 2).join(", ")}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-2 text-center text-xs text-[#534b52]">
                  No high-impact releases scheduled today.
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col h-full overflow-hidden relative bg-[#f1f0ea] min-w-0">
        {/* Responsive Navbar: Always visible on mobile/tablet so user can open sidebar; visible on desktop only when sidebar is closed */}
        <div
          className={`items-center justify-between border-b-2 border-[#2d232e] bg-[#f1f0ea] px-3.5 py-2 sm:px-6 flex-shrink-0 ${isSidebarVisible ? "hidden lg:hidden" : "flex"
            }`}
        >
          <button
            onClick={() => setIsSidebarVisible(true)}
            className="font-heading inline-flex items-center gap-2.5 rounded-md px-2 py-1 text-xs font-bold text-[#2d232e] hover:bg-[#e0ddcf]/60 transition active:scale-95"
            title="Open Sidebar"
          >
            <div className="relative flex-shrink-0">
              <div className="relative size-7 rounded-md border-2 border-[#2d232e] overflow-hidden bg-[#2d232e] shadow-xs animate-terminal-halo">
                <img src="/icon.jpg" alt="Ledgerstone Logo" className="size-full object-cover" />
                <div className="pointer-events-none absolute -inset-full w-[200%] h-[200%] bg-gradient-to-r from-transparent via-[#f1f0ea]/20 to-transparent animate-live-sheen" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0ddcf] opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full border border-[#f1f0ea] bg-[#2d232e]"></span>
              </span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight text-[#2d232e]">Ledgerstone</span>
            <span className="font-heading flex size-6 items-center justify-center rounded-md border border-[#534b52]/40 bg-[#f1f0ea] text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95">&gt;</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDemoViewerOpen(true)}
              className="font-heading inline-flex items-center gap-1.5 rounded-md border-2 border-[#2d232e] bg-[#e0ddcf] px-2.5 py-1 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95 cursor-pointer"
              title="View Demo Sheet Vault"
            >
              <span>▲ Demo Sheet</span>
              {demoTradesList.length > 0 && (
                <span className="rounded-full bg-[#2d232e] px-1.5 text-[9px] text-[#f1f0ea]">
                  {demoTradesList.length}
                </span>
              )}
            </button>

            {!connectionStatus?.connected ? (
              <a
                href="/api/auth/google"
                className="font-heading inline-flex items-center rounded-md bg-[#2d232e] px-2.5 py-1 text-xs font-semibold text-[#f1f0ea] hover:bg-[#474448] transition active:scale-95 shadow-xs"
              >
                Connect Google
              </a>
            ) : (
              <button
                onClick={handleSignOutUser}
                className="font-heading inline-flex lg:hidden rounded-md border border-[#534b52]/40 bg-[#f1f0ea] px-2.5 py-1 text-xs font-semibold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>

        {activeTrades.length > 0 && (
          <div className="border-b-2 border-[#2d232e] bg-[#e0ddcf]/50 p-3 sm:p-4 max-h-56 sm:max-h-72 overflow-y-auto flex-shrink-0">
            <div className="mx-auto max-w-4xl">
              <div className="mb-2 flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="font-heading font-bold uppercase tracking-wider text-[11px] sm:text-xs text-[#2d232e]">
                    Positions Identified
                  </span>
                  <span className="font-heading rounded bg-[#2d232e] px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-bold text-[#f1f0ea]">
                    {activeTrades.length}
                  </span>
                  <span className={`font-heading rounded border border-[#534b52]/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    activeJournalMode === "real"
                      ? "bg-[#e0ddcf] text-[#2d232e]"
                      : "bg-[#2d232e] text-[#f1f0ea]"
                  }`}>
                    {activeJournalMode === "real" ? "● Target: Real Sheet" : "▲ Target: Demo Sheet (Local)"}
                  </span>
                </div>

                {workflowStage === "saved" ? (
                  activeJournalMode === "test" || !connectionStatus?.connected ? (
                    <button
                      onClick={() => setIsDemoViewerOpen(true)}
                      className="font-heading rounded-md bg-[#2d232e] px-2.5 sm:px-3.5 py-1 sm:py-1.5 text-[10px] sm:text-xs font-bold text-[#f1f0ea] shadow-xs hover:bg-[#474448] transition active:scale-95 cursor-pointer"
                    >
                      Saved to Demo Sheet (View)
                    </button>
                  ) : (
                    <span className="font-heading rounded-md bg-[#2d232e] px-2.5 sm:px-3.5 py-1 sm:py-1.5 text-[10px] sm:text-xs font-bold text-[#f1f0ea] shadow-xs">
                      Saved to Sheet
                    </span>
                  )
                ) : (
                  <button
                    onClick={handleSavePositionsToSpreadsheet}
                    disabled={isSavingToSheet || isProcessingRequest || isSwitchingJournalMode}
                    className="font-heading inline-flex items-center rounded-md bg-[#2d232e] px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-bold text-[#f1f0ea] shadow-xs transition hover:bg-[#474448] disabled:opacity-50 active:scale-95 cursor-pointer"
                  >
                    {isSavingToSheet
                      ? "Saving..."
                      : activeJournalMode === "test" || !connectionStatus?.connected
                      ? "Save to Demo Sheet"
                      : "Save to Sheet"}
                  </button>
                )}
              </div>

              <div className="grid gap-2 sm:gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {activeTrades.map((tradeItem, tradeIndex) => {
                  const assetIdentifier = tradeItem.asset || tradeItem.symbol || `Trade ${tradeIndex + 1}`;
                  const isBuyOrder = tradeItem.direction === "BUY";
                  const isSellOrder = tradeItem.direction === "SELL";
                  const hasStopLoss = tradeItem.stopLoss != null;
                  const hasExitPrice = tradeItem.exitPrice != null || tradeItem.target != null;
                  const isTradeComplete = Boolean(tradeItem.asset && tradeItem.direction && tradeItem.entryPrice && hasStopLoss && tradeItem.lotSize);

                  return (
                    <div
                      key={tradeIndex}
                      className={`rounded-lg border-2 p-3 text-xs transition ${isTradeComplete
                        ? "border-[#2d232e] bg-[#f1f0ea] shadow-xs"
                        : "border-[#534b52]/40 bg-[#f1f0ea]"
                        }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-heading font-bold text-xs sm:text-sm text-[#2d232e]">{assetIdentifier}</span>
                          {isBuyOrder && (
                            <span className="font-heading rounded bg-[#2d232e] px-2 py-0.5 text-[10px] font-bold text-[#f1f0ea] tracking-wider">
                              BUY
                            </span>
                          )}
                          {isSellOrder && (
                            <span className="font-heading rounded border-2 border-[#2d232e] bg-transparent px-2 py-0.5 text-[10px] font-bold text-[#2d232e] tracking-wider">
                              SELL
                            </span>
                          )}
                        </div>

                        {isTradeComplete ? (
                          <span className="font-heading rounded bg-[#2d232e] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#f1f0ea]">
                            VERIFIED
                          </span>
                        ) : (
                          <span className="font-heading rounded border border-[#534b52] bg-[#e0ddcf] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#2d232e]">
                            {!tradeItem.asset ? "NEEDS ASSET" : !tradeItem.lotSize ? "NEEDS SIZE" : !hasStopLoss ? "NEEDS SL" : "INCOMPLETE"}
                          </span>
                        )}
                      </div>

                      <div className="font-body grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-[#534b52] pt-2 border-t border-[#e0ddcf]">
                        {tradeItem.entryPrice != null && (
                          <span>Entry: <strong className="text-[#2d232e]">{String(tradeItem.entryPrice)}</strong></span>
                        )}
                        {tradeItem.stopLoss != null && (
                          <span>SL: <strong className="text-[#2d232e]">{String(tradeItem.stopLoss)}</strong></span>
                        )}
                        {tradeItem.target != null && (
                          <span>Target: <strong className="text-[#2d232e]">{String(tradeItem.target)}</strong></span>
                        )}
                        {tradeItem.lotSize != null && (
                          <span>Size: <strong className="text-[#2d232e]">{String(tradeItem.lotSize)}</strong></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Object.keys(dailyReflectionAnswers).length > 0 && (
                <div className="mt-2.5 rounded-lg border-2 border-[#2d232e] bg-[#f1f0ea] p-2.5 sm:p-3 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-heading font-bold text-xs text-[#2d232e] uppercase tracking-wider">
                      Daily Reflection ({dailyReflectionAnswers.date || "Today"})
                    </span>
                    <span className="font-heading rounded bg-[#2d232e] px-2 py-0.5 text-[9px] font-bold uppercase text-[#f1f0ea]">
                      {dailyReflectionAnswers.sleepEnergy && dailyReflectionAnswers.startingBalance != null && dailyReflectionAnswers.improvementGoal ? "COMPLETE" : "IN PROGRESS"}
                    </span>
                  </div>
                  <div className="font-body grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#534b52]">
                    {dailyReflectionAnswers.sleepEnergy && (
                      <div>Energy: <strong className="text-[#2d232e]">{String(dailyReflectionAnswers.sleepEnergy)}</strong></div>
                    )}
                    {dailyReflectionAnswers.dominantEmotion && (
                      <div>Emotion: <strong className="text-[#2d232e]">{String(dailyReflectionAnswers.dominantEmotion)}</strong></div>
                    )}
                    {dailyReflectionAnswers.startingBalance != null && (
                      <div>Balance: <strong className="text-[#2d232e]">${String(dailyReflectionAnswers.startingBalance)} → ${String(dailyReflectionAnswers.endingBalance ?? "")}</strong></div>
                    )}
                    {dailyReflectionAnswers.limitsFollowed && (
                      <div>Limits: <strong className="text-[#2d232e]">{String(dailyReflectionAnswers.limitsFollowed)}</strong></div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="border-b-2 border-[#2d232e] bg-[#e0ddcf] px-4 sm:px-6 py-2.5 text-xs font-semibold text-[#2d232e] flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="ml-3 font-bold text-[#2d232e] hover:underline"
              title="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4 space-y-3">
          <div className="mx-auto max-w-4xl space-y-3">
            {conversationMessages.map((chatMessage, messageIndex) => (
              <div
                key={messageIndex}
                className={`flex ${chatMessage.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs leading-normal shadow-xs ${chatMessage.role === "user"
                    ? "bg-[#2d232e] text-[#f1f0ea]"
                    : "border-2 border-[#e0ddcf] bg-[#f1f0ea] text-[#2d232e]"
                    }`}
                >
                  {chatMessage.role === "assistant" && (
                    <div className="mb-2 flex items-center gap-1.5">
                      <div className="size-4.5 rounded-sm border border-[#2d232e] overflow-hidden bg-[#2d232e] flex-shrink-0">
                        <img src="/icon.jpg" alt="Ledgerstone" className="size-full object-cover" />
                      </div>
                      <span className="font-heading inline-block rounded bg-[#2d232e] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#f1f0ea]">
                        Ledgerstone
                      </span>
                    </div>
                  )}
                  <FormatDialogueContent textContent={chatMessage.content} isUserRole={chatMessage.role === "user"} />
                </div>
              </div>
            ))}

            {isProcessingRequest && (
              <div className="flex justify-start">
                <div className="rounded-lg border-2 border-[#2d232e] bg-[#f1f0ea] px-3.5 py-4 text-xs font-semibold text-[#2d232e] shadow-xs">
                  <span>Processing trade data...</span>
                </div>
              </div>
            )}

            {!isProcessingRequest && suggestedOptionReplies.length > 0 && (
              <div className="pt-2 pb-1">
                <div className="font-heading mb-2 text-xs font-bold uppercase tracking-wider text-[#2d232e]">
                  Suggested Responses
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedOptionReplies.map((replyOption, optionIndex) => (
                    <button
                      key={optionIndex}
                      onClick={() => handleSendUserMessage(replyOption)}
                      disabled={isProcessingRequest || isSwitchingJournalMode}
                      className="font-heading inline-flex items-center rounded-md border-2 border-[#2d232e] bg-[#f1f0ea] px-3 sm:px-3.5 py-1.5 text-xs font-bold text-[#2d232e] shadow-xs transition hover:bg-[#2d232e] hover:text-[#f1f0ea] active:scale-95 disabled:opacity-40"
                    >
                      {replyOption}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={chatContainerEndRef} />
          </div>
        </div>

        <div className="border-t border-[#534b52]/20 bg-[#e0ddcf]/30 p-2.5 sm:p-4 flex-shrink-0">
          <div className="mx-auto max-w-4xl">
            <div className="relative flex items-end rounded-xl border-2 border-[#534b52] bg-[#f1f0ea] p-2 sm:p-2.5 shadow-xs transition focus-within:border-[#2d232e]">
              <textarea
                ref={chatInputTextAreaRef}
                rows={2}
                value={userChatInput}
                disabled={isSwitchingJournalMode}
                onChange={(event) => setUserChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendUserMessage();
                  }
                }}
                placeholder={isSwitchingJournalMode ? "Switching sheet environment..." : "Describe here..."}
                className="flex-1 resize-none bg-transparent px-2 sm:px-2.5 py-1 text-xs outline-hidden text-[#2d232e] placeholder:text-[#534b52] disabled:opacity-50"
              />
              <button
                onClick={() => handleSendUserMessage()}
                disabled={isProcessingRequest || !userChatInput.trim() || isSwitchingJournalMode}
                className="font-heading rounded-md bg-[#2d232e] px-4 py-2 sm:px-5 sm:py-2 text-xs font-bold text-[#f1f0ea] shadow-xs transition hover:bg-[#474448] disabled:opacity-40 active:scale-95 flex-shrink-0"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Full-Screen Environment Switching Overlay Loader with Light Backdrop Blur */}
      {isSwitchingJournalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d232e]/35 backdrop-blur-sm p-4 animate-in fade-in duration-200 select-none cursor-wait"
          role="dialog"
          aria-modal="true"
          aria-label="Switching journal environment"
        >
          <div className="w-full max-w-sm rounded-2xl border-2 border-[#2d232e] bg-[#f1f0ea] p-6 shadow-2xl text-center relative overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Top indeterminate sliding progress bar */}
            <div className="absolute top-0 inset-x-0 h-1.5 bg-[#e0ddcf] overflow-hidden">
              <div className="h-full w-1/2 bg-[#2d232e] rounded-full animate-progress-slide" />
            </div>

            {/* Brand Logo with Live Terminal Halo and Live Sheen */}
            <div className="mx-auto mb-3.5 relative inline-block mt-1">
              <div className="relative size-14 rounded-xl border-2 border-[#2d232e] overflow-hidden bg-[#2d232e] shadow-md animate-terminal-halo">
                <img src="/icon.jpg" alt="Ledgerstone Logo" className="size-full object-cover" />
                <div className="pointer-events-none absolute -inset-full w-[200%] h-[200%] bg-gradient-to-r from-transparent via-[#f1f0ea]/20 to-transparent animate-live-sheen" />
              </div>
              <span className="absolute -bottom-1 -right-1 flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0ddcf] opacity-75"></span>
                <span className="relative inline-flex size-3 rounded-full border border-[#f1f0ea] bg-[#2d232e]"></span>
              </span>
            </div>

            {/* Title */}
            <h3 className="font-heading text-base font-bold text-[#2d232e] mb-1">
              Switching to {switchingTargetMode === "test" ? "Demo / Testing Journal" : "Real Trading Journal"}
            </h3>

            {/* Description */}
            <p className="text-xs text-[#534b52] leading-relaxed mb-4">
              {switchingTargetMode === "test"
                ? "Connecting to your private demo sandbox in Google Drive & isolating test signatures..."
                : "Mounting your primary production trading sheet & synchronizing live trade records..."}
            </p>

            {/* Status Skeleton Chips */}
            <div className="space-y-2 mb-3 text-left">
              <div className="flex items-center justify-between rounded-lg border border-[#534b52]/20 bg-[#e0ddcf]/50 px-3 py-2 text-[11px]">
                <span className="text-[#534b52] flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-[#2d232e] animate-ping" />
                  <span>Target Environment:</span>
                </span>
                <span className="font-heading font-bold text-[#2d232e]">
                  {switchingTargetMode === "test" ? "Demo / Testing" : "Real / Live"}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[#534b52]/20 bg-[#e0ddcf]/50 px-3 py-2 text-[11px]">
                <span className="text-[#534b52]">Storage Scope:</span>
                <span className="font-heading font-bold text-[#2d232e] flex items-center gap-1">
                  <span>Google Drive (drive.file)</span>
                  <span className="text-[9px] rounded bg-[#2d232e] text-[#f1f0ea] px-1 py-0.2">ACTIVE</span>
                </span>
              </div>
            </div>

            <p className="text-[10px] text-[#534b52]">
              Inputs locked temporarily to protect data integrity.
            </p>
          </div>
        </div>
      )}

      {/* ── Demo Sheet Vault Modal ───────────────────────────────────────── */}
      {isDemoViewerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d232e]/70 backdrop-blur-xs p-3 sm:p-6 animate-fade-in">
          <div className="flex flex-col h-[90vh] max-h-[850px] w-full max-w-6xl rounded-2xl border-2 border-[#2d232e] bg-[#f1f0ea] shadow-2xl overflow-hidden font-body text-[#2d232e]">
            {/* Modal Top Bar */}
            <div className="flex items-center justify-between border-b-2 border-[#2d232e] bg-[#e0ddcf] px-4 py-3 sm:px-6 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg border-2 border-[#2d232e] bg-[#2d232e] flex items-center justify-center text-[#f1f0ea] font-heading font-bold text-sm">
                  ▲
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-heading text-base sm:text-lg font-bold text-[#2d232e] leading-none">
                      Demo Sheet Vault
                    </h2>
                    <span className="font-heading rounded bg-[#2d232e] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#f1f0ea]">
                      Local Sandbox
                    </span>
                  </div>
                  <p className="text-[11px] text-[#534b52] mt-0.5">
                    Browser-persisted spreadsheet &bull; 32 canonical columns &bull; Zero login required
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDemoViewerOpen(false)}
                className="font-heading flex size-8 items-center justify-center rounded-lg border-2 border-[#2d232e] bg-[#f1f0ea] text-sm font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95 cursor-pointer"
                title="Close Modal"
              >
                ✕
              </button>
            </div>

            {/* Modal Controls / Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#2d232e] bg-[#f1f0ea] px-4 py-2.5 sm:px-6 flex-shrink-0">
              <div className="flex items-center gap-1.5 rounded-lg border border-[#534b52]/30 bg-[#e0ddcf] p-1">
                <button
                  onClick={() => setDemoViewerTab("trades")}
                  className={`font-heading rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer ${
                    demoViewerTab === "trades"
                      ? "bg-[#2d232e] text-[#f1f0ea] shadow-xs"
                      : "text-[#534b52] hover:text-[#2d232e]"
                  }`}
                >
                  Trades ({demoTradesList.length})
                </button>
                <button
                  onClick={() => setDemoViewerTab("daily")}
                  className={`font-heading rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer ${
                    demoViewerTab === "daily"
                      ? "bg-[#2d232e] text-[#f1f0ea] shadow-xs"
                      : "text-[#534b52] hover:text-[#2d232e]"
                  }`}
                >
                  Daily Reflections ({demoDailyList.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportDemoCSV(demoViewerTab)}
                  className="font-heading inline-flex items-center gap-1.5 rounded-md border-2 border-[#2d232e] bg-[#e0ddcf] px-3 py-1 text-xs font-bold text-[#2d232e] hover:bg-[#2d232e] hover:text-[#f1f0ea] transition active:scale-95 cursor-pointer"
                >
                  Download CSV
                </button>
                {demoTradesList.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm("Clear all recorded demo trades and reflections?")) {
                        try {
                          localStorage.removeItem("ledgerstone_demo_trades");
                          localStorage.removeItem("ledgerstone_demo_daily");
                        } catch {}
                        setDemoTradesList([]);
                        setDemoDailyList([]);
                      }
                    }}
                    className="font-heading inline-flex items-center gap-1.5 rounded-md border border-[#534b52]/40 bg-[#f1f0ea] px-2.5 py-1 text-xs font-medium text-[#534b52] hover:text-red-700 hover:border-red-700 transition active:scale-95 cursor-pointer"
                  >
                    Clear Demo Data
                  </button>
                )}
                {!connectionStatus?.connected && (
                  <a
                    href="/api/auth/google"
                    className="font-heading hidden sm:inline-flex items-center gap-1 rounded-md bg-[#2d232e] px-3 py-1 text-xs font-bold text-[#f1f0ea] hover:bg-[#474448] transition active:scale-95 shadow-xs"
                  >
                    Connect Google Drive &rarr;
                  </a>
                )}
              </div>
            </div>

            {/* Spreadsheet Table View */}
            <div className="flex-1 overflow-auto bg-[#f1f0ea] p-4">
              {demoViewerTab === "trades" ? (
                demoTradesList.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center p-8">
                    <div className="size-14 rounded-2xl border-2 border-[#2d232e] bg-[#e0ddcf] flex items-center justify-center font-heading font-bold text-xl text-[#2d232e] mb-3">
                      ▲
                    </div>
                    <h3 className="font-heading text-base font-bold text-[#2d232e] mb-1">
                      Demo Sheet Vault is Empty
                    </h3>
                    <p className="text-xs text-[#534b52] max-w-sm mb-4">
                      You haven&apos;t saved any demo trades yet. Describe your trades in the chat terminal and tap &quot;Save to Demo Sheet&quot; to see all 32 calculated columns rendered here!
                    </p>
                    <button
                      onClick={() => setIsDemoViewerOpen(false)}
                      className="font-heading rounded-lg bg-[#2d232e] px-4 py-2 text-xs font-bold text-[#f1f0ea] hover:bg-[#474448] transition cursor-pointer"
                    >
                      Log a Demo Trade &rarr;
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-[#2d232e] overflow-hidden bg-[#f1f0ea] shadow-xs">
                    <div className="overflow-x-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-left text-xs whitespace-nowrap">
                        <thead className="sticky top-0 z-10 border-b-2 border-[#2d232e] bg-[#2d232e] text-[#f1f0ea] font-heading font-bold">
                          <tr>
                            <th className="px-3 py-2 text-center w-10">#</th>
                            {FIELDS.map((field) => (
                              <th key={field.key} className="px-3 py-2 border-r border-[#474448]/50">
                                {field.header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e0ddcf]">
                          {demoTradesList.map((trade, idx) => {
                            const rowVals = toRow(trade, FIELDS.map((f) => f.header));
                            const isWin = String(trade.result || "").toUpperCase() === "WIN";
                            const isLoss = String(trade.result || "").toUpperCase() === "LOSS";
                            return (
                              <tr
                                key={idx}
                                className={`hover:bg-[#e0ddcf]/50 transition ${
                                  idx % 2 === 0 ? "bg-[#f1f0ea]" : "bg-[#e0ddcf]/20"
                                }`}
                              >
                                <td className="px-3 py-2 text-center font-bold text-[#534b52] border-r border-[#e0ddcf]">
                                  {idx + 1}
                                </td>
                                {rowVals.map((cellVal, colIdx) => {
                                  const header = FIELDS[colIdx]?.header;
                                  const isResultCol = header === "Result";
                                  const isPnLCol = header === "PnL";
                                  return (
                                    <td
                                      key={colIdx}
                                      className={`px-3 py-2 border-r border-[#e0ddcf] font-mono text-[11px] ${
                                        isResultCol
                                          ? isWin
                                            ? "font-bold text-emerald-800"
                                            : isLoss
                                            ? "font-bold text-rose-800"
                                            : "text-[#2d232e]"
                                          : isPnLCol
                                          ? isWin
                                            ? "font-bold text-emerald-800"
                                            : isLoss
                                            ? "font-bold text-rose-800"
                                            : "text-[#2d232e]"
                                          : "text-[#2d232e]"
                                      }`}
                                    >
                                      {cellVal == null || cellVal === "" ? "—" : String(cellVal)}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : (
                demoDailyList.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center p-8">
                    <div className="size-14 rounded-2xl border-2 border-[#2d232e] bg-[#e0ddcf] flex items-center justify-center font-heading font-bold text-xl text-[#2d232e] mb-3">
                      ●
                    </div>
                    <h3 className="font-heading text-base font-bold text-[#2d232e] mb-1">
                      No Daily Reflections Saved
                    </h3>
                    <p className="text-xs text-[#534b52] max-w-sm mb-4">
                      Answer the 11-step psychological audit questions during your trade logging session to store your reflections here.
                    </p>
                    <button
                      onClick={() => setIsDemoViewerOpen(false)}
                      className="font-heading rounded-lg bg-[#2d232e] px-4 py-2 text-xs font-bold text-[#f1f0ea] hover:bg-[#474448] transition cursor-pointer"
                    >
                      Return to Chat &rarr;
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-[#2d232e] overflow-hidden bg-[#f1f0ea] shadow-xs">
                    <div className="overflow-x-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-left text-xs whitespace-nowrap">
                        <thead className="sticky top-0 z-10 border-b-2 border-[#2d232e] bg-[#2d232e] text-[#f1f0ea] font-heading font-bold">
                          <tr>
                            <th className="px-3 py-2 text-center w-10">#</th>
                            {DAILY_FIELDS.map((field) => (
                              <th key={field.key} className="px-3 py-2 border-r border-[#474448]/50">
                                {field.header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e0ddcf]">
                          {demoDailyList.map((dailyItem, idx) => {
                            const rowVals = toDailyRow(dailyItem, DAILY_FIELDS.map((f) => f.header));
                            return (
                              <tr
                                key={idx}
                                className={`hover:bg-[#e0ddcf]/50 transition ${
                                  idx % 2 === 0 ? "bg-[#f1f0ea]" : "bg-[#e0ddcf]/20"
                                }`}
                              >
                                <td className="px-3 py-2 text-center font-bold text-[#534b52] border-r border-[#e0ddcf]">
                                  {idx + 1}
                                </td>
                                {rowVals.map((cellVal, colIdx) => (
                                  <td
                                    key={colIdx}
                                    className="px-3 py-2 border-r border-[#e0ddcf] font-mono text-[11px] text-[#2d232e]"
                                  >
                                    {cellVal == null || cellVal === "" ? "—" : String(cellVal)}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Modal Bottom Status Bar */}
            <div className="border-t-2 border-[#2d232e] bg-[#e0ddcf] px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
              <div className="flex items-center gap-4 text-[#534b52]">
                <span>
                  Total Demo Trades: <strong className="text-[#2d232e] font-heading">{demoTradesList.length}</strong>
                </span>
                <span>
                  Daily Audits: <strong className="text-[#2d232e] font-heading">{demoDailyList.length}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsDemoViewerOpen(false)}
                  className="font-heading rounded-lg bg-[#2d232e] px-4 py-1.5 text-xs font-bold text-[#f1f0ea] hover:bg-[#474448] transition active:scale-95 cursor-pointer"
                >
                  Close Viewer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormatDialogueContent({ textContent, isUserRole }: { textContent: string; isUserRole: boolean }) {
  if (isUserRole) {
    return <div className="whitespace-pre-wrap font-body text-xs leading-normal">{textContent}</div>;
  }

  const lineItems = textContent.split("\n");

  return (
    <div className="space-y-1 font-body text-xs leading-normal">
      {lineItems.map((lineText, lineIndex) => {
        if (!lineText.trim()) return <div key={lineIndex} className="h-0.5" />;

        if (lineText.startsWith("- ") || lineText.startsWith("* ") || lineText.startsWith("+ ")) {
          return (
            <div key={lineIndex} className="ml-1.5 flex items-start gap-1.5">
              <span className="text-[#2d232e] font-bold">-</span>
              <span>{renderInlineSpans(lineText.substring(2))}</span>
            </div>
          );
        }

        const numericListItemMatch = lineText.match(/^(\d+[\.\)])\s+(.*)/);
        if (numericListItemMatch) {
          return (
            <div key={lineIndex} className="ml-1.5 flex items-start gap-1.5">
              <span className="font-heading font-bold text-[#2d232e]">{numericListItemMatch[1]}</span>
              <span>{renderInlineSpans(numericListItemMatch[2])}</span>
            </div>
          );
        }

        return <p key={lineIndex}>{renderInlineSpans(lineText)}</p>;
      })}
    </div>
  );
}

function renderInlineSpans(sourceText: string) {
  const renderedElements: (string | React.ReactNode)[] = [];
  const tokenExpression = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let cursorPosition = 0;
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = tokenExpression.exec(sourceText)) !== null) {
    if (tokenMatch.index > cursorPosition) {
      renderedElements.push(sourceText.substring(cursorPosition, tokenMatch.index));
    }

    const matchedToken = tokenMatch[0];
    if (matchedToken.startsWith("**") && matchedToken.endsWith("**")) {
      renderedElements.push(
        <strong key={tokenMatch.index} className="font-heading font-semibold text-[#2d232e]">
          {matchedToken.slice(2, -2)}
        </strong>
      );
    } else if (matchedToken.startsWith("*") && matchedToken.endsWith("*")) {
      renderedElements.push(
        <span key={tokenMatch.index} className="text-[#534b52] font-medium font-body">
          {matchedToken.slice(1, -1)}
        </span>
      );
    } else if (matchedToken.startsWith("[") && matchedToken.includes("](")) {
      const markdownLinkMatch = matchedToken.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (markdownLinkMatch) {
        renderedElements.push(
          <a
            key={tokenMatch.index}
            href={markdownLinkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2 text-[#474448] hover:text-[#2d232e]"
          >
            {markdownLinkMatch[1]}
          </a>
        );
      }
    }

    cursorPosition = tokenMatch.index + matchedToken.length;
  }

  if (cursorPosition < sourceText.length) {
    renderedElements.push(sourceText.substring(cursorPosition));
  }

  return renderedElements.length > 0 ? renderedElements : sourceText;
}
