import { NextResponse, type NextRequest } from "next/server";
import {
  appendTrades,
  appendDailyReflection,
  getActiveEnvironment,
  type JournalEnvironment,
} from "@/services/google/sheets";
import {
  cleanTrade,
  deriveAll,
  extractNumber,
  parseRiskReward,
  istDate,
  istTimestamp,
} from "@/core/derive";
import {
  processChatTurn,
  deterministicFallback,
  validateTradeMandatoryFields,
  getNextMissingTradeField,
  deepMergeDaily,
  deepMergeTrades,
  deduplicateTradeRows,
  type ChatMessage,
  type ChatResponse,
} from "@/services/gemini/chat";
import { AI_FIELDS, type FieldKey, type TradeRow } from "@/core/fields";
import {
  DAILY_FIELDS,
  type DailyFieldKey,
  type DailyReflectionRow,
  normalizeDailyReflection,
  getNextEmptyDailyField,
} from "@/core/daily";
import { SESSION_COOKIE, getSessionEmail } from "@/lib/session";
import { acquireDistributedLock, releaseDistributedLock } from "@/lib/store";

export const dynamic = "force-dynamic";

function cleanDaily(raw: Record<string, unknown>): DailyReflectionRow {
  return normalizeDailyReflection(raw);
}

export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    const userEmail = (await getSessionEmail(cookie)) || undefined;

    const body = (await request.json()) as {
      messages?: ChatMessage[];
      currentTrades?: Record<string, unknown>[];
      dailyAnswers?: Record<string, unknown>;
      forceSave?: boolean;
      mode?: JournalEnvironment;
    };

    const messages = body.messages ?? [];
    const currentTrades = (body.currentTrades ?? []).map(cleanTrade);
    const dailyAnswers = cleanDaily(body.dailyAnswers ?? {});
    const targetEnv: JournalEnvironment = userEmail ? (body.mode || (await getActiveEnvironment(userEmail))) : "test";

    const lastUserText = messages[messages.length - 1]?.content?.trim().toLowerCase() || "";
    const isSaveRequest =
      body.forceSave ||
      lastUserText === "save trades now" ||
      lastUserText === "save now" ||
      lastUserText === "save trades" ||
      lastUserText === "save" ||
      lastUserText === "skip" ||
      lastUserText === "skip questions" ||
      lastUserText === "done" ||
      lastUserText === "finish";

    // Direct save request
    if (isSaveRequest) {
      if (currentTrades.length === 0) {
        return NextResponse.json({ ok: false, error: "No trades to save." }, { status: 400 });
      }

      const completeTrades = currentTrades.map((t) => deriveAll(t));
      const hasDailyKeys = Object.keys(dailyAnswers).filter((k) => dailyAnswers[k as keyof DailyReflectionRow]);
      const hasDaily = hasDailyKeys.length > 0;

      // Demo sandbox bypass: direct save without Google account
      if (!userEmail && targetEnv === "test") {
        return NextResponse.json({
          ok: true,
          stage: "saved",
          isDemo: true,
          demoLocal: true,
          url: "#demo-sheet",
          tradesSaved: completeTrades.length,
          dailySaved: hasDaily,
          trades: completeTrades,
          daily: dailyAnswers,
          assistantMessage:
            `**Successfully saved to Demo Sandbox!**\n\n` +
            `- **${completeTrades.length} trade${completeTrades.length === 1 ? "" : "s"}** calculated and added to your local Demo Sheet.\n` +
            `${hasDaily ? "- **Daily Reflection** recorded in your Demo Daily Reflections.\n" : ""}\n` +
            `*Demo trades are preserved in your local browser sandbox. No Google account required. You can view the demo sheet or export as CSV below.*`,
          suggestedReplies: ["Journal more trades", "View Demo Sheet", "Download CSV"],
        });
      }

      let saveResult;
      try {
        saveResult = await appendTrades(completeTrades, userEmail, targetEnv);
      } catch (saveErr) {
        console.error("[chat] Failed to append trades in targetEnv:", targetEnv, saveErr);
        if (targetEnv === "test") {
          const reasonText = !userEmail
            ? "Saved to local sandbox (Google account not connected)."
            : `Saved to local sandbox (Google Sheet notice: ${saveErr instanceof Error ? saveErr.message : "could not write to sheet"}).`;
          return NextResponse.json({
            ok: true,
            stage: "saved",
            isDemo: true,
            demoLocal: true,
            url: "#demo-sheet",
            tradesSaved: completeTrades.length,
            dailySaved: hasDaily,
            trades: completeTrades,
            daily: dailyAnswers,
            assistantMessage:
              `**Successfully saved to Demo Sandbox!**\n\n` +
              `- **${completeTrades.length} trade${completeTrades.length === 1 ? "" : "s"}** calculated and added to your local Demo Sheet.\n` +
              `${hasDaily ? "- **Daily Reflection** recorded.\n" : ""}\n` +
              `*${reasonText}*`,
            suggestedReplies: ["Journal more trades", "View Demo Sheet", "Download CSV"],
          });
        }
        throw saveErr;
      }
      const { url, rows, alreadySaved } = saveResult;

      let dailySaved = false;
      if (hasDaily) {
        try {
          const fullDaily: DailyReflectionRow = {
            ...dailyAnswers,
            date: dailyAnswers.date || istDate(),
            createdAt: istTimestamp(),
          };
          await appendDailyReflection(fullDaily, userEmail, targetEnv);
          dailySaved = true;
        } catch (dailyErr) {
          console.error("Failed to append daily reflection in save request:", dailyErr);
        }
      }

      if (alreadySaved && rows === 0) {
        return NextResponse.json({
          ok: true,
          stage: "saved",
          url,
          tradesSaved: 0,
          dailySaved,
          trades: completeTrades,
          daily: dailyAnswers,
          assistantMessage:
            `**Trades already recorded in Google Sheets.**\n\n` +
            `All ${completeTrades.length} position${completeTrades.length === 1 ? "" : "s"} are already saved in your **Trades** tab. Deduplication prevented duplicate entries.\n\n` +
            `[Open your Google Sheet](${url})`,
          suggestedReplies: ["Journal more trades", "Open Sheet"],
        });
      }

      return NextResponse.json({
        ok: true,
        stage: "saved",
        url,
        tradesSaved: rows,
        dailySaved,
        trades: completeTrades,
        daily: dailyAnswers,
        assistantMessage:
          `**Successfully saved to Google Sheets!**\n\n` +
          `- **${rows} trade${rows === 1 ? "" : "s"}** added to your **Trades** tab.\n` +
          `${dailySaved ? "- **Daily Reflection** recorded in your **Daily Reflections** tab.\n" : ""}\n` +
          `[Open your Google Sheet](${url})`,
        suggestedReplies: ["Journal more trades", "Open Sheet"],
      });
    }

    // Process normal conversational turn with AI
    let turn: ChatResponse;
    try {
      turn = await processChatTurn(messages, currentTrades, dailyAnswers);
    } catch (turnErr) {
      console.warn("[chat] AI turn failed completely, using deterministic fallback:", turnErr);
      turn = deterministicFallback(messages, currentTrades, dailyAnswers);
    }

    // Deep-merge trades and daily reflection (preserves all previously entered fields)
    let cleanedTrades = deepMergeTrades(currentTrades, (turn.trades || []).map(cleanTrade));
    let mergedDaily = deepMergeDaily(dailyAnswers, turn.daily);

    // Deterministic Answer Binding:
    // If the assistant just asked a specific question in the previous turn,
    // bind the user's latest reply directly to that field so it is NEVER lost or wiped by LLMs!
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const lastAssistantText = assistantMessages[assistantMessages.length - 1]?.content || "";
    const rawUserReply = messages[messages.length - 1]?.content?.trim() || "";

    // Determine target trade index when discussing multiple positions
    let targetTradeIndex = 0;
    const tradeNumberMatch = lastAssistantText.match(/Trade\s+(\d+)/i);
    if (tradeNumberMatch) {
      const parsedIdx = parseInt(tradeNumberMatch[1], 10) - 1;
      if (parsedIdx >= 0 && parsedIdx < cleanedTrades.length) {
        targetTradeIndex = parsedIdx;
      }
    } else if (cleanedTrades.length > 1) {
      const assetMatchIdx = cleanedTrades.findIndex((tr) => {
        const a = String(tr.asset || tr.symbol || "").toLowerCase();
        return a && lastAssistantText.toLowerCase().includes(a);
      });
      if (assetMatchIdx >= 0) {
        targetTradeIndex = assetMatchIdx;
      }
    }

    // Global Risk:Reward scan across any user reply in this turn
    const userStatedRR = parseRiskReward(rawUserReply);
    if (userStatedRR != null && cleanedTrades.length > 0) {
      cleanedTrades[targetTradeIndex].riskReward = userStatedRR;
    }

    if (rawUserReply && lastAssistantText) {
      if (cleanedTrades.length === 0 && (lastAssistantText.includes("asset or instrument") || lastAssistantText.includes("asset or symbol"))) {
        const cleanAsset = rawUserReply.replace(/^(?:i\s+traded|traded|it\s+was|symbol\s+is|asset\s+is)\s+/i, "").trim();
        cleanedTrades.push({ asset: cleanAsset || rawUserReply, symbol: cleanAsset || rawUserReply });
      } else if (cleanedTrades.length > 0) {
        const t = cleanedTrades[targetTradeIndex];
        if (lastAssistantText.includes("asset or instrument") || lastAssistantText.includes("asset or symbol")) {
          const cleanAsset = rawUserReply.replace(/^(?:i\s+traded|traded|it\s+was|symbol\s+is|asset\s+is)\s+/i, "").trim();
          t.asset = cleanAsset || rawUserReply;
          if (!t.symbol) t.symbol = t.asset;
        } else if (lastAssistantText.includes("BUY (Long) or SELL (Short)") || lastAssistantText.includes("BUY or SELL")) {
          const l = rawUserReply.toLowerCase();
          t.direction = l.includes("buy") || l.includes("long") || l.includes("bull") ? "BUY" : "SELL";
        } else if (lastAssistantText.includes("entry price")) {
          const n = extractNumber(rawUserReply);
          if (n != null && n > 0) t.entryPrice = n;
        } else if (lastAssistantText.includes("lot size or contract quantity") || lastAssistantText.includes("lot size")) {
          const n = extractNumber(rawUserReply);
          if (n != null && n > 0) t.lotSize = n;
        } else if (lastAssistantText.includes("stop loss")) {
          const l = rawUserReply.toLowerCase();
          if (l.includes("no sl") || l.includes("none") || l.includes("without sl") || l.includes("no stop")) {
            t.stopLoss = 0;
          } else {
            const n = extractNumber(rawUserReply);
            if (n != null) t.stopLoss = n;
          }
        } else if (lastAssistantText.includes("exit price or target outcome") || lastAssistantText.includes("exit price")) {
          const l = rawUserReply.toLowerCase();
          if (l.includes("hit target") || l.includes("target hit") || l.includes("tp hit")) {
            if (t.target != null) {
              t.exitPrice = Number(t.target);
            } else if (t.entryPrice != null && t.stopLoss != null) {
              const rr = parseRiskReward(t.riskReward) || 2;
              const risk = Math.abs(Number(t.entryPrice) - Number(t.stopLoss));
              t.exitPrice = t.direction === "SELL" ? Number(t.entryPrice) - risk * rr : Number(t.entryPrice) + risk * rr;
            }
          } else if (l.includes("hit stop loss") || l.includes("stopped out") || l.includes("sl hit")) {
            if (t.stopLoss != null) t.exitPrice = Number(t.stopLoss);
          } else if (l.includes("breakeven") || l.includes("be")) {
            if (t.entryPrice != null) t.exitPrice = Number(t.entryPrice);
          } else {
            const n = extractNumber(rawUserReply);
            if (n != null && n > 0) t.exitPrice = n;
          }
          if (userStatedRR != null) t.riskReward = userStatedRR;
        } else if (lastAssistantText.includes("trading session")) {
          const u = rawUserReply.toUpperCase();
          if (u.includes("LONDON")) t.session = "LONDON";
          else if (u.includes("NEW YORK") || u.includes("NY")) t.session = "NEW YORK";
          else if (u.includes("ASIA") || u.includes("TOKYO")) t.session = "ASIA";
          else if (u.includes("OVERLAP")) t.session = "OVERLAP";
          else t.session = rawUserReply;
        } else if (lastAssistantText.includes("market conditions during this") || (!lastAssistantText.includes("Daily Reflection") && lastAssistantText.includes("market conditions"))) {
          t.marketCondition = rawUserReply;
        } else if (lastAssistantText.includes("setup or entry trigger") || lastAssistantText.includes("setup or strategy")) {
          t.setupName = rawUserReply;
          t.strategy = rawUserReply;
        } else if (lastAssistantText.includes("reason for entry") || lastAssistantText.includes("trigger / confluence")) {
          t.reasonForEntry = rawUserReply;
        } else if (lastAssistantText.includes("reason for exit")) {
          t.reasonForExit = rawUserReply;
        } else if (lastAssistantText.includes("dominant emotion before entering") || lastAssistantText.includes("emotion before")) {
          t.emotionBefore = rawUserReply;
        } else if (lastAssistantText.includes("dominant emotion while holding") || lastAssistantText.includes("emotion during")) {
          t.emotionDuring = rawUserReply;
        } else if (lastAssistantText.includes("feel after closing") || lastAssistantText.includes("emotion after")) {
          t.emotionAfter = rawUserReply;
        } else if (lastAssistantText.includes("trading plan rules")) {
          const u = rawUserReply.toUpperCase();
          if (u.includes("100") || u.includes("FOLLOWED") || u.includes("YES") || u.includes("DISCIPLIN")) t.ruleAdherence = "FOLLOWED (100%)";
          else if (u.includes("PARTIAL") || u.includes("SOME")) t.ruleAdherence = "PARTIAL";
          else if (u.includes("BROKE") || u.includes("NO") || u.includes("FAILED")) t.ruleAdherence = "BROKE RULES";
          else t.ruleAdherence = rawUserReply;
        } else if (lastAssistantText.includes("execution mistakes")) {
          const u = rawUserReply.toUpperCase();
          if (u.includes("NONE") || u.includes("CLEAN") || u.includes("DISCIPLIN") || u.includes("NO") || u.includes("ZERO")) t.executionMistakes = "NONE";
          else if (u.includes("FOMO")) t.executionMistakes = "FOMO";
          else if (u.includes("REVENGE")) t.executionMistakes = "REVENGE";
          else if (u.includes("MOVED SL") || u.includes("STOP")) t.executionMistakes = "MOVED SL/TP";
          else if (u.includes("EARLY")) t.executionMistakes = "EARLY ENTRY";
          else if (u.includes("CHASED")) t.executionMistakes = "CHASED PRICE";
          else if (u.includes("OVERTRAD")) t.executionMistakes = "OVERTRADING";
          else t.executionMistakes = rawUserReply;
        }
      }

      // Direct Daily Reflection bindings
      if (lastAssistantText.includes("Sleep & Energy") || lastAssistantText.includes("sleep, energy, focus")) {
        const l = rawUserReply.toLowerCase();
        if (l.includes("high") || l.includes("rested") || l.includes("great") || l.includes("fresh") || l.includes("good")) {
          mergedDaily.sleepEnergy = "HIGH";
        } else if (l.includes("low") || l.includes("poor") || l.includes("tired") || l.includes("fatigue") || l.includes("bad")) {
          mergedDaily.sleepEnergy = "LOW";
        } else {
          mergedDaily.sleepEnergy = "MODERATE";
        }
      } else if (lastAssistantText.includes("Dominant Emotion") || lastAssistantText.includes("dominant emotion before starting")) {
        const u = rawUserReply.toUpperCase();
        const valid = ["CALM", "FOCUSED", "ANXIOUS", "EXCITED", "TIRED", "FRUSTRATED", "CONFIDENT"];
        const m = valid.find((v) => u.includes(v));
        mergedDaily.dominantEmotion = m || (u.length > 20 ? "CALM" : u);
      } else if (lastAssistantText.includes("account starting balance") || lastAssistantText.includes("Starting Balance")) {
        const n = extractNumber(rawUserReply);
        if (n != null && n > 0) mergedDaily.startingBalance = n;
      } else if (lastAssistantText.includes("account ending balance") || lastAssistantText.includes("Ending Balance")) {
        const n = extractNumber(rawUserReply);
        if (n != null && n > 0) mergedDaily.endingBalance = n;
      } else if (lastAssistantText.includes("Limits Followed") || lastAssistantText.includes("daily loss limit")) {
        const u = rawUserReply.toUpperCase();
        if (u.includes("YES") || u.includes("FOLLOWED") || u.includes("100%") || u.includes("STAYED")) mergedDaily.limitsFollowed = "YES";
        else if (u.includes("NO") || u.includes("EXCEEDED") || u.includes("BROKE")) mergedDaily.limitsFollowed = "NO";
        else mergedDaily.limitsFollowed = "YES";
      } else if (lastAssistantText.includes("Impulsive / Revenge") || lastAssistantText.includes("impulsive, revenge, or boredom")) {
        const u = rawUserReply.toUpperCase();
        if (u.includes("NONE") || u.includes("DISCIPLIN") || u.includes("NO") || u.includes("ZERO")) mergedDaily.impulsiveTrades = "NONE";
        else if (u.includes("IMPULSIVE")) mergedDaily.impulsiveTrades = "IMPULSIVE";
        else if (u.includes("REVENGE")) mergedDaily.impulsiveTrades = "REVENGE";
        else if (u.includes("BOREDOM")) mergedDaily.impulsiveTrades = "BOREDOM";
        else mergedDaily.impulsiveTrades = "NONE";
      } else if (lastAssistantText.includes("Valid Setups Skipped") || lastAssistantText.includes("valid setups you skipped")) {
        mergedDaily.skippedSetups = rawUserReply;
      } else if (lastAssistantText.includes("Biggest Mistake") || lastAssistantText.includes("biggest mistake today")) {
        mergedDaily.biggestMistake = rawUserReply;
      } else if (lastAssistantText.includes("Best Decision") || lastAssistantText.includes("best decision today")) {
        mergedDaily.bestDecision = rawUserReply;
      } else if (lastAssistantText.includes("Daily Reflection (10/11)") || (lastAssistantText.includes("Daily Reflection") && lastAssistantText.includes("Market Conditions")) || lastAssistantText.includes("market conditions or news")) {
        mergedDaily.marketConditions = rawUserReply;
      } else if (lastAssistantText.includes("One Thing to Improve") || lastAssistantText.includes("important thing to improve")) {
        mergedDaily.improvementGoal = rawUserReply;
      }
    }

    turn.trades = deduplicateTradeRows(cleanedTrades);
    turn.daily = mergedDaily;

    // 1. Mandatory Trade Fields Enforcement (Strictly ONE question at a time)
    const missingTrade = getNextMissingTradeField(cleanedTrades);
    if (missingTrade && !isSaveRequest) {
      turn.stage = "collecting_trades";
      turn.assistantMessage = missingTrade.question;
      turn.suggestedReplies = missingTrade.options;
    } else if (cleanedTrades.length > 0 && !isSaveRequest) {
      // 2. Sequential Daily Reflection Enforcement (Strictly ONE question at a time in exact sheet column order)
      const nextDaily = getNextEmptyDailyField(mergedDaily);
      if (nextDaily) {
        turn.stage = "daily_questions";
        turn.assistantMessage = `**Daily Reflection (${nextDaily.stepNumber}/${nextDaily.totalSteps}): ${nextDaily.header}**\n\n${nextDaily.question}`;
        // Options strictly for this question. If dynamic number/text, array is empty!
        turn.suggestedReplies = nextDaily.options;
      } else {
        turn.stage = "ready_to_save";
      }
    }

    // If progression decided all info is complete and ready to save
    if (turn.stage === "ready_to_save" && turn.trades.length > 0) {
      const cleaned = turn.trades.map(cleanTrade);
      const completeTrades = deduplicateTradeRows(cleaned).map((t) => deriveAll(t));
      const cleanedDaily = cleanDaily(turn.daily || {});
      const hasDailyKeys = Object.keys(cleanedDaily).filter((k) => cleanedDaily[k as keyof DailyReflectionRow]);
      const hasDaily = hasDailyKeys.length > 0;

      // Demo sandbox bypass: auto-save locally without Google connection
      if (!userEmail && targetEnv === "test") {
        return NextResponse.json({
          ok: true,
          stage: "saved",
          isDemo: true,
          demoLocal: true,
          url: "#demo-sheet",
          tradesSaved: completeTrades.length,
          dailySaved: hasDaily,
          trades: completeTrades,
          daily: cleanedDaily,
          assistantMessage:
            `${turn.assistantMessage}\n\n` +
            `**Saved to Demo Sandbox!**\n` +
            `- **${completeTrades.length} trade${completeTrades.length === 1 ? "" : "s"}** calculated and added to your local Demo Sheet.\n` +
            `${hasDaily ? "- **Daily Reflection** recorded in your Demo Daily Reflections.\n" : ""}\n` +
            `*Demo trades are preserved in your local browser sandbox. No Google account required. You can view the demo sheet or export as CSV below.*`,
          suggestedReplies: ["Journal more trades", "View Demo Sheet", "Download CSV"],
        });
      }

      const lockKey = `lock:save:${userEmail || "anonymous"}`;
      const lockAcquired = await acquireDistributedLock(lockKey, 15);
      if (!lockAcquired) {
        return NextResponse.json({
          ok: true,
          ...turn,
          assistantMessage:
            `${turn.assistantMessage}\n\n` +
            `Save notice: A sync operation is currently active for your account. Please wait a moment.`,
          suggestedReplies: ["Save trades now", "Open Sheet"],
        });
      }

      try {
        let saveResult;
        try {
          saveResult = await appendTrades(completeTrades, userEmail, targetEnv);
        } catch (appendErr) {
          console.error("[chat] Failed auto-append in targetEnv:", targetEnv, appendErr);
          if (targetEnv === "test") {
            const reasonText = !userEmail
              ? "Saved to local sandbox (Google account not connected)."
              : `Saved to local sandbox (Google Sheet notice: ${appendErr instanceof Error ? appendErr.message : "could not write to sheet"}).`;
            return NextResponse.json({
              ok: true,
              stage: "saved",
              isDemo: true,
              demoLocal: true,
              url: "#demo-sheet",
              tradesSaved: completeTrades.length,
              dailySaved: hasDaily,
              trades: completeTrades,
              daily: cleanedDaily,
              assistantMessage:
                `${turn.assistantMessage}\n\n` +
                `**Saved to Demo Sandbox!**\n` +
                `- **${completeTrades.length} trade${completeTrades.length === 1 ? "" : "s"}** calculated and recorded locally.\n\n` +
                `*${reasonText}*`,
              suggestedReplies: ["Journal more trades", "View Demo Sheet", "Download CSV"],
            });
          }
          throw appendErr;
        }

        const { url, rows, alreadySaved } = saveResult;

        let dailySaved = false;
        if (hasDaily) {
          try {
            const fullDaily: DailyReflectionRow = {
              ...cleanedDaily,
              date: cleanedDaily.date || istDate(),
              createdAt: istTimestamp(),
            };
            await appendDailyReflection(fullDaily, userEmail, targetEnv);
            dailySaved = true;
          } catch (dailyErr) {
            console.error("Failed to append daily reflection in auto-save:", dailyErr);
          }
        }

        if (alreadySaved && rows === 0) {
          return NextResponse.json({
            ok: true,
            stage: "saved",
            url,
            tradesSaved: 0,
            dailySaved,
            trades: completeTrades,
            daily: cleanedDaily,
            assistantMessage:
              `${turn.assistantMessage}\n\n` +
              `**Trades already recorded in Google Sheets.** Deduplication prevented duplicate entries.\n\n` +
              `[Open your Google Sheet](${url})`,
            suggestedReplies: ["Journal more trades", "Open Sheet"],
          });
        }

        return NextResponse.json({
          ok: true,
          stage: "saved",
          url,
          tradesSaved: rows,
          dailySaved,
          trades: completeTrades,
          daily: cleanedDaily,
          assistantMessage:
            `${turn.assistantMessage}\n\n` +
            `**Saved to Google Sheets!**\n` +
            `- **${rows} trade${rows === 1 ? "" : "s"}** added to your **Trades** tab.\n` +
            `${dailySaved ? "- **Daily Reflection** recorded in your **Daily Reflections** tab.\n" : ""}\n` +
            `[Open your Google Sheet](${url})`,
          suggestedReplies: ["Journal more trades", "Open Sheet"],
        });
      } catch (saveError) {
        console.error("Auto-save failed:", saveError);
        const errorMsg = saveError instanceof Error ? saveError.message : "Auto-save failed";
        return NextResponse.json({
          ok: true,
          assistantMessage:
            `${turn.assistantMessage}\n\n` +
            `**Google Sheets sync notice:** ${errorMsg}.\n` +
            `Your trades and daily reflection are intact in this session. Tap **Save trades now** below to record them.`,
          trades: turn.trades.map(cleanTrade),
          daily: cleanDaily(turn.daily || {}),
          suggestedReplies: ["Save trades now", "Open Sheet"],
          stage: "daily_questions",
        });
      } finally {
        await releaseDistributedLock(lockKey);
      }
    }

    return NextResponse.json({
      ok: true,
      ...turn,
      daily: cleanDaily(turn.daily || {}),
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Chat failed";
    let message = rawMessage;

    if (rawMessage === "NOT_CONNECTED") {
      message = "Not connected to Google — please reconnect and try again.";
    } else if (
      rawMessage.includes("503") ||
      rawMessage.includes("high demand") ||
      rawMessage.includes("UNAVAILABLE")
    ) {
      message =
        "Google AI is temporarily experiencing high demand. Please tap Retry, or tap Save trades now to record your journal directly to Google Sheets.";
    } else if (rawMessage.includes("429") || rawMessage.includes("RESOURCE_EXHAUSTED")) {
      message = "Google AI rate limit reached. Please wait a moment and tap Retry.";
    } else {
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed?.error?.message) {
          message = parsed.error.message;
        }
      } catch {
        // keep message as-is
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: rawMessage === "NOT_CONNECTED" ? 401 : 500 },
    );
  }
}
