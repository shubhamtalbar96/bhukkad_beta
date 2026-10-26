"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAccount, updateDisplayName } from "@/app/actions";

export default function AccountSettings({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(displayName);
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <section className="panel stack">
      <h2 style={{ fontSize: 22 }}>Account</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateDisplayName(name);
            setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
          });
        }}
      >
        <label className="field" htmlFor="display-name">
          Name shown on your ratings
          <input id="display-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div><button className="btn" type="submit" disabled={pending}>Save name</button></div>
      </form>

      {!showDelete ? (
        <div><button className="muted" style={{ fontWeight: 700 }} onClick={() => setShowDelete(true)}>Delete my account and data</button></div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await deleteAccount(confirm);
              if (r.ok) router.push("/");
              else setMsg({ ok: false, text: r.error });
            });
          }}
        >
          <p style={{ margin: 0 }}>
            This permanently deletes your account, ratings, check-ins, dish votes and saved places. Type <b>delete</b> to confirm.
          </p>
          <div className="addrow">
            <input id="confirm-delete" type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label='Type "delete" to confirm' />
            <button className="btn primary" type="submit" disabled={pending}>Delete everything</button>
          </div>
        </form>
      )}
      {msg ? <p className={msg.ok ? "ok" : "err"} style={{ margin: 0 }} role="status">{msg.text}</p> : null}
    </section>
  );
}
