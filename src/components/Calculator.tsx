"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilmPicker } from "@/components/FilmPicker";
import { ScottishLogo } from "@/components/ScottishLogo";
import {
  REPS,
  findRep,
  priceJob,
  roundMoney,
  type JobPriceResult,
  type Rep,
} from "@/lib/commission";
import { booksDataLabel } from "@/lib/freshness";
import { formatMoney, formatRate, formatSell } from "@/lib/format";
import { isAdmin } from "@/lib/auth/access";
import { creditCardFlagKey, flagForJob, type StoredCreditCardFlag } from "@/lib/credit-card-flag";
import { isSoldQuoteStatus, quoteMatches } from "@/lib/quotes";
import { priceSnapshotJob } from "@/lib/snapshot-price";
import type { CatalogFilm, CommissionSnapshot, SnapshotJob } from "@/lib/types";

type LineEdit = {
  id: string;
  filmQuery: string;
  catalogProduct: string | null;
  sellPerSf: number | null;
  pricingGroup: number | null;
  sf: string;
  removal: boolean;
  cBond: boolean;
  description: string;
  itemName: string;
  lineAmount: number | null;
  frenchMention: boolean;
};

type JobEdit = {
  charged: string;
  frenchPanes: string;
  listOverride: string;
  managerApproved: boolean;
  lines: LineEdit[];
};

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFrench(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Number(trimmed);
}

function blankLine(id: string): LineEdit {
  return {
    id,
    filmQuery: "",
    catalogProduct: null,
    sellPerSf: null,
    pricingGroup: null,
    sf: "",
    removal: false,
    cBond: false,
    description: "",
    itemName: "",
    lineAmount: null,
    frenchMention: false,
  };
}

function jobToEdit(job: SnapshotJob): JobEdit {
  const lines = job.films.length
    ? job.films.map((film, index) => ({
        id: `${job.id}-line-${index}`,
        filmQuery: film.catalogProduct || film.film || "",
        catalogProduct: film.catalogProduct,
        sellPerSf: film.sellPerSf,
        pricingGroup: film.pricingGroup,
        sf: film.sf == null ? "" : String(film.sf),
        removal: film.removal,
        cBond: film.cBond,
        description: film.description,
        itemName: film.itemName,
        lineAmount: film.lineAmount,
        frenchMention: film.french,
      }))
    : [blankLine(`${job.id}-line-0`)];
  return {
    charged: String(job.charged),
    frenchPanes: "0",
    listOverride: "",
    managerApproved: false,
    lines,
  };
}

function priceEdit(rate: number, edit: JobEdit, sold: boolean, paidByCreditCard: boolean): JobPriceResult {
  return priceJob({
    rate,
    charged: parseNumber(edit.charged),
    frenchPanes: parseFrench(edit.frenchPanes),
    listOverride: parseNumber(edit.listOverride),
    managerApproved: edit.managerApproved,
    sold,
    paidByCreditCard,
    lines: edit.lines.map((line) => ({
      sellPerSf: line.sellPerSf,
      sf: parseNumber(line.sf),
      removal: line.removal,
      cBond: line.cBond,
    })),
  });
}

function cardNote(result: JobPriceResult): string {
  if (!result.paidByCreditCard || result.charged == null || result.creditCardFee <= 0) return "";
  const fee = formatMoney(result.creditCardFee);
  const amount = formatMoney(result.charged);
  const adjusted = formatMoney(result.commission);
  if (result.commission === result.commissionBeforeCreditCard) {
    return ` Credit card fee ${fee} (2.9% of ${amount}). Commission stays ${adjusted}.`;
  }
  return ` Credit card fee ${fee} (2.9% of ${amount}) was deducted from the commission base after the tier was chosen. Adjusted commission is ${adjusted}.`;
}

function explain(result: JobPriceResult, rateLabel: string): string {
  let text: string;
  if (result.notSold) {
    text = "Not sold in Zoho Books — no commission.";
  } else if (result.commission == null) {
    text = "Enter the pre-fee amount charged to calculate commission.";
  } else if (!result.listVerified) {
    text = `List not verified. Commission is ${rateLabel} of the charged amount.`;
  } else if (result.belowFloor && !result.managerApproved) {
    text = "Below the 10% floor. Commission is $0 unless a manager approved this price in writing.";
  } else if (result.belowFloor && result.managerApproved) {
    text = `Manager approved. Commission is ${rateLabel} of list minus half the shortfall, and it does not go below $0.`;
  } else if (result.status === "undersold") {
    text = `Undersold by less than 10%. Commission is ${rateLabel} of list minus half the shortfall.`;
  } else if (result.status === "oversold") {
    text = `Charged is above list, so commission is ${rateLabel} of the charged amount.`;
  } else {
    text = `Charged matches list, so commission is ${rateLabel} of the charged amount.`;
  }
  return `${text}${cardNote(result)}`;
}

export function Calculator({
  snapshot,
  username,
}: {
  snapshot: CommissionSnapshot;
  username: string;
}) {
  const [repId, setRepId] = useState<Rep["id"]>("dana");
  const [query, setQuery] = useState("");
  const [jobId, setJobId] = useState("");
  const [edits, setEdits] = useState<Record<string, JobEdit>>({});
  const [flags, setFlags] = useState<Record<string, StoredCreditCardFlag>>({});
  const [flagsStatus, setFlagsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [flagError, setFlagError] = useState<string | null>(null);
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const saveSeq = useRef<Record<string, number>>({});
  const admin = isAdmin(username);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/commission-flags", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("flags");
        return (await response.json()) as { flags?: Record<string, StoredCreditCardFlag> };
      })
      .then((body) => {
        if (cancelled) return;
        setFlags(body.flags ?? {});
        setFlagsStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setFlagsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rep = REPS.find((item) => item.id === repId) ?? REPS[0];
  const repJobs = useMemo(
    () => snapshot.jobs.filter((job) => findRep(job.salesperson)?.id === rep.id),
    [snapshot.jobs, rep.id],
  );

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return [];
    return repJobs.filter(
      (job) =>
        quoteMatches(job, needle) ||
        job.client.toLowerCase().includes(needle) ||
        job.jobNumber.toLowerCase().includes(needle),
    );
  }, [repJobs, needle]);
  const matches = filtered.slice(0, 8);

  const selected = repJobs.find((job) => job.id === jobId) ?? null;
  const edit = useMemo(
    () => (selected ? (edits[selected.id] ?? jobToEdit(selected)) : null),
    [selected, edits],
  );
  const paidByCreditCard = selected
    ? flagForJob(selected, flags)?.paidByCreditCard === true
    : false;
  const live = useMemo(
    () =>
      edit && selected
        ? priceEdit(rep.rate, edit, isSoldQuoteStatus(selected.quoteStatus), paidByCreditCard)
        : null,
    [edit, rep.rate, selected, paidByCreditCard],
  );
  const dirty = selected ? edits[selected.id] != null : false;
  const rateLabel = formatRate(rep.rate);
  const discountLines = selected?.discountLines ?? [];
  const discountTotal = discountLines.length
    ? roundMoney(discountLines.reduce((sum, line) => sum + line.amount, 0))
    : 0;

  function updateEdit(job: SnapshotJob, recipe: (current: JobEdit) => JobEdit) {
    setEdits((prev) => {
      const current = prev[job.id] ?? jobToEdit(job);
      return { ...prev, [job.id]: recipe(current) };
    });
  }

  function pickJob(job: SnapshotJob) {
    setJobId(job.id);
    setQuery("");
  }

  async function setPaidByCard(job: SnapshotJob, nextPaid: boolean) {
    const key = creditCardFlagKey(job);
    if (!key) return;
    const seq = (saveSeq.current[job.id] ?? 0) + 1;
    saveSeq.current[job.id] = seq;
    const previous = flags[key];
    setFlagError(null);
    setSavingJobId(job.id);
    setFlags((current) => ({
      ...current,
      [key]: {
        paidByCreditCard: nextPaid,
        updatedBy: username,
        updatedAt: new Date().toISOString(),
        estimateNumber: job.estimateNumber,
        jobNumber: job.jobNumber,
        quoteNumber: job.zoho,
        jobId: job.id,
      },
    }));
    try {
      const response = await fetch("/api/commission-flags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id, paidByCreditCard: nextPaid }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        key?: string;
        flag?: StoredCreditCardFlag;
      };
      if (saveSeq.current[job.id] !== seq) return;
      if (!response.ok || !body.flag || !body.key) {
        setFlags((current) => {
          const restored = { ...current };
          if (previous) restored[key] = previous;
          else delete restored[key];
          return restored;
        });
        setFlagError(body.error || "Could not save the credit card flag.");
        return;
      }
      setFlags((current) => ({ ...current, [body.key!]: body.flag! }));
    } catch {
      if (saveSeq.current[job.id] !== seq) return;
      setFlags((current) => {
        const restored = { ...current };
        if (previous) restored[key] = previous;
        else delete restored[key];
        return restored;
      });
      setFlagError("Could not save the credit card flag.");
    } finally {
      if (saveSeq.current[job.id] === seq) setSavingJobId(null);
    }
  }

  return (
    <div className="wrap">
      <header className="mast">
        <div className="mast-top">
          <ScottishLogo />
          <div className="mast-actions">
            {admin ? (
              <a className="text-btn" href="/admin/usage">
                API usage
              </a>
            ) : null}
            <form action="/api/logout" method="post">
              <button className="text-btn" type="submit">
                Sign out{username ? ` ${username}` : ""}
              </button>
            </form>
          </div>
        </div>
        <h1>Commission calculator</h1>
        <p className="lede">
          Pick a sales rep, then one job. Film, square footage, the commissionable amount, and
          add-ons recalculate commission as you edit.
        </p>
        <p className="asof">{booksDataLabel(snapshot)}</p>
      </header>

      <section className="finder" aria-label="Find a job">
        <div className="field">
          <label htmlFor="rep">Sales rep</label>
          <select
            id="rep"
            value={rep.id}
            onChange={(event) => {
              setRepId(event.target.value as Rep["id"]);
              setJobId("");
              setQuery("");
            }}
          >
            {REPS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({formatRate(item.rate)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="job-search">Job</label>
          <input
            id="job-search"
            type="search"
            value={query}
            autoComplete="off"
            placeholder="WT-03533 or WT-03533-QT01"
            onChange={(event) => setQuery(event.target.value)}
          />
          {needle ? (
            <div className="matches">
              {matches.length === 0 ? (
                <p className="empty">No {rep.shortName} job matches “{query.trim()}”.</p>
              ) : (
                <ul aria-label="Matching jobs">
                  {matches.map((job) => {
                    const preview = priceSnapshotJob(job);
                    return (
                      <li key={job.id}>
                        <button type="button" onClick={() => pickJob(job)}>
                          <span className="match-title">
                            {job.zoho}
                            {job.jobNumber ? ` · ${job.jobNumber}` : ""}
                          </span>
                          <span className="match-client">{job.client}</span>
                          <span className="match-meta">
                            {job.dateSold || "No date"} · {formatMoney(job.charged)} commissionable
                            {preview.notSold ? " · Not sold" : ""}
                            {preview.needsReview ? " · Needs review" : ""}
                            {!preview.notSold && !preview.listVerified ? " · List not verified" : ""}
                            {preview.belowFloor ? " · Below 10% floor" : ""}
                            {job.commissionableAmountVerified === false ? " · Commissionable amount not verified" : ""}
                            {job.lineItemsAvailable === false ? " · Line items not available" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {filtered.length > matches.length ? (
                <p className="more">Keep typing to narrow {filtered.length} matches.</p>
              ) : null}
            </div>
          ) : (
            <p className="hint">
              {repJobs.length === 0
                ? `${rep.name} has no jobs in this snapshot.`
                : `Search ${rep.shortName}'s Books quotes by WT number.`}
            </p>
          )}
        </div>
      </section>

      {!selected || !edit || !live ? (
        <p className="waiting">Choose a job to see list price, charged amount, and commission.</p>
      ) : (
        <div className="workspace">
          <section className="editor" aria-label="Job inputs">
            <div className="job-head">
              <div>
                <p className="eyebrow">This job</p>
                <h2>{selected.client || "Untitled job"}</h2>
              </div>
              <div className="badges">
                {live.notSold ? <span className="badge unsold">Not sold</span> : null}
                {live.needsReview ? <span className="badge review">Needs review</span> : null}
                {!live.notSold && !live.listVerified ? (
                  <span className="badge unverified">List not verified</span>
                ) : null}
                {!live.notSold && live.belowFloor ? <span className="badge floor">Below 10% floor</span> : null}
                {!live.notSold && live.listVerified && live.status === "undersold" ? (
                  <span className="badge under">Undersold</span>
                ) : null}
                {!live.notSold && live.listVerified && live.status === "oversold" ? (
                  <span className="badge over">Oversold</span>
                ) : null}
                {!live.notSold && live.listVerified && live.status === "ok" ? (
                  <span className="badge ok">At list</span>
                ) : null}
                {dirty ? <span className="badge edit">Edited</span> : null}
                {selected.commissionableAmountVerified === false ? (
                  <span className="badge unverified">Commissionable amount not verified</span>
                ) : null}
                {selected.lineItemsAvailable === false ? (
                  <span className="badge review">Line items not available</span>
                ) : null}
              </div>
            </div>

            <dl className="facts">
              <div>
                <dt>ZOHO quote</dt>
                <dd>{selected.zoho || "—"}</dd>
              </div>
              <div>
                <dt>Job number</dt>
                <dd>{selected.jobNumber || "—"}</dd>
              </div>
              <div>
                <dt>Date sold</dt>
                <dd>{selected.acceptedDate ? selected.dateSold : "—"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{selected.location || "—"}</dd>
              </div>
              <div>
                <dt>Sheet film type</dt>
                <dd>{selected.filmType || "—"}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>{selected.estimateNumber || "—"}</dd>
              </div>
              <div>
                <dt>Books status</dt>
                <dd>{selected.quoteStatus || "Not in Books"}</dd>
              </div>
            </dl>

            {live.reasons.length > 0 ? (
              <div className="callout" role="status">
                {live.reasons.join(" ")}
                {live.needsReview && live.usedOverride
                  ? " The list override is used for commission, and the job stays marked needs review until film and square footage are filled in."
                  : ""}
              </div>
            ) : null}
            {selected.commissionableAmountVerified === false ? (
              <div className="callout" role="status">
                Commissionable amount not verified. An unclassified line was left out of the
                commissionable amount. Check the excluded lines before paying this job.
              </div>
            ) : null}
            {selected.lineItemsAvailable === false ? (
              <div className="callout" role="status">
                Line items not available. Commission uses the quote total with the 4% fee removed.
              </div>
            ) : null}

            <div className="lines">
              {edit.lines.map((line, index) => (
                <article key={line.id} className="line">
                  <div className="line-top">
                    <h3>Film {index + 1}</h3>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        updateEdit(selected, (current) => ({
                          ...current,
                          lines: current.lines.filter((item) => item.id !== line.id),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  {line.itemName || line.description ? (
                    <p className="quote">
                      {line.itemName ? <strong>{line.itemName}. </strong> : null}
                      {line.description}
                      {line.lineAmount != null ? ` Quote line ${formatMoney(line.lineAmount)}.` : ""}
                    </p>
                  ) : null}
                  <FilmPicker
                    query={line.filmQuery}
                    catalog={snapshot.catalog}
                    onChange={(nextQuery, film: CatalogFilm | null) =>
                      updateEdit(selected, (current) => ({
                        ...current,
                        lines: current.lines.map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                filmQuery: nextQuery,
                                catalogProduct: film?.product ?? null,
                                sellPerSf: film?.sellPerSf ?? null,
                                pricingGroup: film?.pricingGroup ?? null,
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                  <div className="split">
                    <div className="field">
                      <label htmlFor={`${line.id}-sf`}>Square feet</label>
                      <input
                        id={`${line.id}-sf`}
                        inputMode="decimal"
                        value={line.sf}
                        placeholder="Billed SF"
                        onChange={(event) =>
                          updateEdit(selected, (current) => ({
                            ...current,
                            lines: current.lines.map((item) =>
                              item.id === line.id ? { ...item, sf: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </div>
                    <p className="sell">
                      List {formatSell(line.sellPerSf)}/SF
                      {line.pricingGroup ? ` · group ${line.pricingGroup}` : ""}
                      <br />
                      Line list {formatLineList(live.lineAmounts[index])}
                    </p>
                  </div>
                  <div className="checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={line.removal}
                        onChange={(event) =>
                          updateEdit(selected, (current) => ({
                            ...current,
                            lines: current.lines.map((item) =>
                              item.id === line.id
                                ? { ...item, removal: event.target.checked }
                                : item,
                            ),
                          }))
                        }
                      />
                      Removal (+$1.25/SF)
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={line.cBond}
                        onChange={(event) =>
                          updateEdit(selected, (current) => ({
                            ...current,
                            lines: current.lines.map((item) =>
                              item.id === line.id ? { ...item, cBond: event.target.checked } : item,
                            ),
                          }))
                        }
                      />
                      C-Bond (+$1.25/SF)
                    </label>
                  </div>
                </article>
              ))}
              <button
                type="button"
                className="add"
                onClick={() =>
                  updateEdit(selected, (current) => ({
                    ...current,
                    lines: [...current.lines, blankLine(`${selected.id}-new-${current.lines.length}-${Date.now()}`)],
                  }))
                }
              >
                Add film line
              </button>
            </div>

            <div className="money-inputs">
              <div className="field">
                <label htmlFor="charged">Commissionable amount</label>
                <input
                  id="charged"
                  inputMode="decimal"
                  value={edit.charged}
                  onChange={(event) =>
                    updateEdit(selected, (current) => ({ ...current, charged: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="french">French panes ($3 each)</label>
                <input
                  id="french"
                  inputMode="decimal"
                  value={edit.frenchPanes}
                  onChange={(event) =>
                    updateEdit(selected, (current) => ({
                      ...current,
                      frenchPanes: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <span className="check-caption">Manager approval</span>
                <label className={live.belowFloor && !edit.managerApproved ? "approval hot" : "approval"}>
                  <input
                    type="checkbox"
                    checked={edit.managerApproved}
                    onChange={(event) =>
                      updateEdit(selected, (current) => ({
                        ...current,
                        managerApproved: event.target.checked,
                      }))
                    }
                  />
                  Manager approved in writing
                </label>
              </div>
              <div className="field">
                <span className="check-caption">Payment</span>
                <label className={admin ? "approval" : "approval locked"}>
                  <input
                    type="checkbox"
                    checked={paidByCreditCard}
                    disabled={!admin || flagsStatus !== "ready" || savingJobId === selected.id}
                    onChange={(event) => setPaidByCard(selected, event.target.checked)}
                  />
                  Paid by credit card
                </label>
                {flagsStatus === "loading" ? <p className="hint">Loading the saved payment flag.</p> : null}
                {flagsStatus === "error" ? (
                  <p className="hint">
                    The saved payment flag could not be loaded. Refresh before changing it.
                  </p>
                ) : null}
                {flagError ? <p className="hint">{flagError}</p> : null}
                {paidByCreditCard && live.creditCardFee <= 0 ? (
                  <p className="hint">
                    The 2.9% fee applies only when the commissionable amount is over $10,000, so this
                    checkbox does not change the commission.
                  </p>
                ) : null}
                {!admin ? (
                  <p className="hint">Only an admin can change this. The fee still shows here.</p>
                ) : null}
                {flagForJob(selected, flags) ? (
                  <p className="hint">
                    Last change {flagForJob(selected, flags)?.updatedBy} ·{" "}
                    {new Date(flagForJob(selected, flags)?.updatedAt || "").toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="override">List override (optional, pre-fee)</label>
                <input
                  id="override"
                  inputMode="decimal"
                  value={edit.listOverride}
                  placeholder="Blank uses catalog × SF"
                  onChange={(event) =>
                    updateEdit(selected, (current) => ({
                      ...current,
                      listOverride: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {edit.lines.some((line) => line.frenchMention) ? (
              <p className="hint">The quote mentions French panes. Enter the pane count above if it should be on the list.</p>
            ) : null}
            <button
              type="button"
              className="text-btn reset"
              disabled={!dirty}
              onClick={() =>
                setEdits((prev) => {
                  const next = { ...prev };
                  delete next[selected.id];
                  return next;
                })
              }
            >
              Reset this job to the snapshot
            </button>
          </section>

          <aside className="result" aria-live="polite">
            <p className="eyebrow">Commission</p>
            <p className="commission">{formatMoney(live.commission)}</p>
            <p className="explain">{explain(live, rateLabel)}</p>
            <dl className="ledger">
              {selected.quoteAmount != null ? (
                <div>
                  <dt>Full quote</dt>
                  <dd>{formatMoney(selected.quoteAmount)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{live.usedOverride ? "List override" : "List price"}</dt>
                <dd>{formatMoney(live.listPrice)}</dd>
              </div>
              <div>
                <dt>Commissionable</dt>
                <dd>{formatMoney(live.charged)}</dd>
              </div>
              {discountLines.length > 0 ? (
                <div>
                  <dt>Discounts</dt>
                  <dd className="neg">{formatMoney(discountTotal)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Over / under</dt>
                <dd className={live.difference != null && live.difference < 0 ? "neg" : undefined}>
                  {live.difference == null ? "—" : formatMoney(live.difference)}
                </dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd>{rateLabel}</dd>
              </div>
              {live.paidByCreditCard ? (
                <div>
                  <dt>Credit card fee</dt>
                  <dd className={live.creditCardFee > 0 ? "neg" : undefined}>
                    {formatMoney(live.creditCardFee)}
                  </dd>
                </div>
              ) : null}
              {live.creditCardFee > 0 && live.commissionBeforeCreditCard != null ? (
                <div>
                  <dt>Before card fee</dt>
                  <dd>{formatMoney(live.commissionBeforeCreditCard)}</dd>
                </div>
              ) : null}
              {live.paidByCreditCard ? (
                <div>
                  <dt>Adjusted commission</dt>
                  <dd>{formatMoney(live.commission)}</dd>
                </div>
              ) : null}
            </dl>
            {discountLines.length > 0 ? (
              <div className="excluded">
                <h3>Discounts</h3>
                <p className="hint">Already subtracted from the commissionable amount.</p>
                <ul>
                  {discountLines.map((line, index) => (
                    <li key={`${line.name}-${index}`}>
                      <span className="excluded-name">{line.name || "Discount"}</span>
                      <span className="excluded-amount neg">{formatMoney(line.amount)}</span>
                      <span className="excluded-reason">{line.reason}</span>
                      {line.description ? <span className="excluded-desc">{line.description}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.excludedLines && selected.excludedLines.length > 0 ? (
              <div className="excluded">
                <h3>Excluded from commission</h3>
                <ul>
                  {selected.excludedLines.map((line, index) => (
                    <li key={`${line.name}-${index}`}>
                      <span className="excluded-name">{line.name || "Untitled line"}</span>
                      <span className="excluded-amount">{formatMoney(line.amount)}</span>
                      <span className="excluded-reason">{line.reason}</span>
                      {line.description ? <span className="excluded-desc">{line.description}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      )}

      <details className="rules">
        <summary>Commission rules</summary>
        <p>
          Only Dana (7%), Amy (5%), Blake (15%), Scott (15%), and John (15%) earn commission.
          Commission is calculated on the commissionable amount: window film, film removal, C-Bond,
          and labor-only install, minus discounts such as Over/Short, military, and Less X%.
          Travel, mileage, lifts, equipment rental, the 4% fee, permits, parking, and other
          non-film extras are excluded. A line that cannot be classified is excluded and the job
          is marked commissionable amount not verified. A discount does not raise that flag. A
          quote with no line
          items keeps the quote total with the 4% fee removed and is marked line items not
          available. If the commissionable amount is at or above list, commission is the rate times
          that amount. Example: list $1,000 at 5%, sold for $1,100, pays $55. If the job is
          undersold by less than 10% of list, commission is the rate times list minus half the
          shortfall. Example: list $1,000 at 5%, sold for $950, pays $50 − $25 = $25. If the
          commissionable amount is 10% or more below list, commission is $0 unless a manager
          approved the price in writing. With that approval, the undersold formula applies and
          commission does not go below $0. Example: list $1,000 at 5%, sold for $900, pays $0. If
          list cannot be computed, commission is the rate times the commissionable amount and the
          job is marked list not verified. A job missing film or square footage is marked needs
          review.
          When a job is marked paid by credit card and its commissionable amount is over $10,000,
          a 2.9% fee on that amount is deducted from the commission base after the list tier is
          chosen, then the rate is applied. Example: $20,000 commissionable, fee $580, base
          $19,420, Blake at 15% pays $2,913. At $10,000 or under, the checkbox does not change
          the commission. The fee cannot push a job into the undersold tiers. For an undersold
          job under 10%, the fee is subtracted from the commission base that the undersold
          formula already produced (commission = that result minus the rate times the fee).
        </p>
      </details>
    </div>
  );
}

function formatLineList(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return formatMoney(roundMoney(amount));
}
