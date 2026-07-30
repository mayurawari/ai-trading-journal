"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AI_FIELDS, GROUPS, type Field } from "@/core/fields";

type Stage = "write" | "review" | "saved";
type Values = Record<string, string>;

interface Draft {
  values: Values;
  derived: Record<string, unknown>;
}

interface Status {
  connected: boolean;
  email?: string;
  sheet?: { url: string; trades: number | null } | null;
}

const EXAMPLE =
  "I bought Gold today around London open at 3385.20 with 0.03 lots after a liquidity " +
  "sweep above Asia high. My stop loss was 3381.50 and target was 3397. I got emotional " +
  "because I missed the first entry so I entered a bit late. Eventually price hit target. " +
  "Later I shorted Nifty at 24850 with 2 lots, stop at 24900, but it stopped me out.";

/** Short label for a tab: "Gold BUY", falling back gracefully when fields are blank. */
function summarise(values: Values, index: number): string {
  const name = values.asset || values.symbol;
  const dir = values.direction;
  if (name && dir) return `${name} ${dir}`;
  if (name) return name;
  return `Trade ${index + 1}`;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [stage, setStage] = useState<Stage>("write");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ url: string | null; rows: number }>({ url: null, rows: 0 });
  const reviewRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await (await fetch("/api/status")).json());
    } catch {
      /* status is decorative — never block journaling on it */
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError(params.get("error"));
    if (params.get("error") || params.get("connected")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    void refresh();
  }, [refresh]);

  async function extract() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error);
        return;
      }

      setDrafts(
        (data.trades ?? []).map((t: { fields: Record<string, unknown>; derived: unknown }) => {
          const values: Values = {};
          for (const [key, value] of Object.entries(t.fields ?? {})) {
            if (value !== null && value !== undefined) values[key] = String(value);
          }
          return { values, derived: (t.derived ?? {}) as Record<string, unknown> };
        }),
      );
      setActive(0);
      setStage("review");
      requestAnimationFrame(() =>
        reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades: drafts.map((d) => d.values) }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setSaved({ url: data.url, rows: data.rows ?? drafts.length });
      setStage("saved");
      void refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function update(key: string, value: string) {
    setDrafts((list) =>
      list.map((d, i) => (i === active ? { ...d, values: { ...d.values, [key]: value } } : d)),
    );
  }

  function removeTrade(index: number) {
    setDrafts((list) => list.filter((_, i) => i !== index));
    setActive((a) => (index < a || a === drafts.length - 1 ? Math.max(0, a - 1) : a));
  }

  function reset() {
    setText("");
    setDrafts([]);
    setActive(0);
    setSaved({ url: null, rows: 0 });
    setError(null);
    setStage("write");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const current = drafts[active];
  const totalFilled = drafts.reduce(
    (sum, d) => sum + AI_FIELDS.filter((f) => d.values[f.key]?.trim()).length,
    0,
  );

  return (
    <main className="mx-auto max-w-3xl px-5 pb-32 pt-10 sm:px-8">
      <Header status={status} />

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!status?.connected && status !== null ? (
        <Connect />
      ) : stage === "saved" ? (
        <Saved url={saved.url} rows={saved.rows} onNext={reset} />
      ) : (
        <>
          <section>
            <label htmlFor="trade" className="mb-2 block text-sm font-medium">
              Describe your trades
            </label>
            <textarea
              id="trade"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void extract();
              }}
              rows={7}
              placeholder="Write it the way you'd tell another trader. Several trades in one go is fine."
              className="field resize-y leading-relaxed"
              style={{ fontSize: "0.95rem" }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={extract}
                disabled={busy || !text.trim()}
                className="rounded-lg bg-[--color-accent] px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:text-neutral-900"
              >
                {busy && stage === "write" ? "Reading…" : "Extract fields"}
              </button>
              {!text && (
                <button
                  onClick={() => setText(EXAMPLE)}
                  className="text-sm text-[--color-ink-2] underline underline-offset-4"
                >
                  Use an example
                </button>
              )}
              <span className="ml-auto text-xs text-[--color-ink-2]">⌘/Ctrl + Enter</span>
            </div>
          </section>

          {stage === "review" && current && (
            <div ref={reviewRef} className="mt-12">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">
                  {drafts.length === 1
                    ? "Check before saving"
                    : `Found ${drafts.length} trades — check each one`}
                </h2>
                <span className="text-xs text-[--color-ink-2]">
                  {totalFilled} field{totalFilled === 1 ? "" : "s"} filled
                </span>
              </div>

              {drafts.length > 1 && (
                <Tabs
                  drafts={drafts}
                  active={active}
                  onSelect={setActive}
                  onRemove={removeTrade}
                />
              )}

              <Derived derived={current.derived} />

              <Fields values={current.values} onChange={update} />

              <ActionBar
                busy={busy}
                count={drafts.length}
                disabled={totalFilled === 0}
                onSave={save}
                onReset={reset}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Header({ status }: { status: Status | null }) {
  return (
    <header className="mb-10 flex items-baseline justify-between gap-4">
      <h1 className="text-lg font-semibold tracking-tight">AI Trading Journal</h1>
      {status?.connected && (
        <div className="flex items-center gap-3 text-xs text-[--color-ink-2]">
          {status.sheet && (
            <a
              href={status.sheet.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {status.sheet.trades ?? 0} saved
            </a>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Connected
          </span>
        </div>
      )}
    </header>
  );
}

function Connect() {
  return (
    <div className="rounded-xl border border-[--color-line] bg-[--color-surface-2] p-8 text-center">
      <p className="mb-4 text-sm text-[--color-ink-2]">
        Connect your Google account to start journaling.
      </p>
      <a
        href="/api/auth/google"
        className="inline-block rounded-lg bg-[--color-accent] px-4 py-2 text-sm font-medium text-white dark:text-neutral-900"
      >
        Connect Google
      </a>
    </div>
  );
}

function Saved({ url, rows, onNext }: { url: string | null; rows: number; onNext: () => void }) {
  return (
    <div className="rounded-xl border border-[--color-line] bg-[--color-surface-2] p-8 text-center">
      <div className="mb-3 text-2xl">✓</div>
      <p className="mb-1 font-medium">
        {rows} trade{rows === 1 ? "" : "s"} saved
      </p>
      <p className="mb-6 text-sm text-[--color-ink-2]">
        Added as {rows === 1 ? "a new row" : `${rows} new rows`} in your sheet.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={onNext}
          className="rounded-lg bg-[--color-accent] px-4 py-2 text-sm font-medium text-white dark:text-neutral-900"
        >
          Journal more trades
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[--color-line] px-4 py-2 text-sm font-medium"
          >
            Open sheet
          </a>
        )}
      </div>
    </div>
  );
}

/** One tab per detected trade, so several trades stay reviewable without endless scroll. */
function Tabs({
  drafts,
  active,
  onSelect,
  onRemove,
}: {
  drafts: Draft[];
  active: number;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {drafts.map((draft, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={`group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
            i === active
              ? "border-[--color-accent] bg-[--color-surface-2] font-medium"
              : "border-[--color-line] text-[--color-ink-2]"
          }`}
        >
          <span className="tabular-nums opacity-50">{i + 1}</span>
          {summarise(draft.values, i)}
          {drafts.length > 1 && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Remove this trade"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onRemove(i);
                }
              }}
              className="ml-1 opacity-40 hover:opacity-100"
            >
              ✕
            </span>
          )}
        </button>
      ))}
      <span className="text-xs text-[--color-ink-2]">
        split wrongly? remove one, or fix the text and extract again
      </span>
    </div>
  );
}

function Fields({
  values,
  onChange,
}: {
  values: Values;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-8">
      {GROUPS.filter((g) => g !== "Auto").map((group) => {
        const fields = AI_FIELDS.filter((f) => f.group === group);
        if (fields.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-[--color-ink-2]">
              {group}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <Input
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={(v) => onChange(field.key, v)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only preview of what the app calculates, so risk/reward can be sanity-checked. */
function Derived({ derived }: { derived: Record<string, unknown> }) {
  const chips = [
    { label: "Risk / Reward", value: derived.riskReward },
    { label: "Result", value: derived.result },
    { label: "Week", value: derived.weekNumber },
  ].filter((c) => c.value !== null && c.value !== undefined);

  if (chips.length === 0) return null;

  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="rounded-lg border border-[--color-line] bg-[--color-surface-2] px-3 py-1.5 text-xs"
        >
          <span className="text-[--color-ink-2]">{chip.label}</span>{" "}
          <span className="font-medium">{String(chip.value)}</span>
        </span>
      ))}
      <span className="self-center text-xs text-[--color-ink-2]">calculated automatically</span>
    </div>
  );
}

function Input({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const empty = !value.trim();

  return (
    <label className={field.long ? "sm:col-span-2" : undefined}>
      <span className={`mb-1.5 block text-xs ${empty ? "text-[--color-ink-2]" : "font-medium"}`}>
        {field.header}
      </span>

      {field.type === "enum" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
          <option value="">—</option>
          {field.values?.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : field.long ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="field resize-y"
        />
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field"
        />
      )}
    </label>
  );
}

function ActionBar({
  busy,
  count,
  disabled,
  onSave,
  onReset,
}: {
  busy: boolean;
  count: number;
  disabled: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-[--color-line] bg-[--color-surface]/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 sm:px-8">
        <button
          onClick={onReset}
          className="text-sm text-[--color-ink-2] underline underline-offset-4"
        >
          Start over
        </button>
        <button
          onClick={onSave}
          disabled={busy || disabled}
          className="ml-auto rounded-lg bg-[--color-accent] px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:text-neutral-900"
        >
          {busy ? "Saving…" : count === 1 ? "Save to sheet" : `Save ${count} trades`}
        </button>
      </div>
    </div>
  );
}
