import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/board/back-link";
import { MoveMenu } from "@/components/board/move-menu";
import { Assignee } from "@/components/board/ticket-card";
import {
  CommentDelete,
  CommentForm,
  CopyLinkButton,
  TicketDelete,
  TicketSeen,
} from "@/components/board/ticket-client";
import { DueLabel, formatLongDay, UrgencyChip } from "@/components/board/urgency-chip";
import { UserAvatar } from "@/components/shell/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { SUTUN_SLUGS } from "@/lib/board/labels";
import { getTicket } from "@/lib/board/queries";
import { COMMENT_DELETE_WINDOW_S } from "@/lib/board/rules";
import {
  formatAuditDate,
  formatAuditDateTime,
  formatShortDateTime,
  istanbulDateOf,
  now,
} from "@/lib/time";
import { cn } from "@/lib/utils";

const excerpt = (body: string) => (body.length > 40 ? `${body.slice(0, 40)}…` : body);

export async function generateMetadata({ params }: PageProps<"/yonetim/[numara]">) {
  const { numara } = await params;
  return { title: `#${numara} · Yönetim Kurulu` };
}

export default async function TicketPage({ params }: PageProps<"/yonetim/[numara]">) {
  const { numara } = await params;
  const t = await getTicket(numara);
  if (!t) notFound();
  const today = istanbulDateOf(now());
  const comments = t.thread.filter((e) => e.kind === "comment").length;

  const facts = (
    <div data-testid="ticket-facts" className="space-y-2.5 rounded-2xl border bg-card p-4 text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
        <dt className="text-muted-foreground">Sorumlu</dt>
        <dd data-testid="ticket-assignee">
          <Assignee assignee={t.assignee} />
        </dd>
        <dt className="text-muted-foreground">Aciliyet</dt>
        <dd>
          <UrgencyChip urgency={t.urgency} />
        </dd>
        <dt className="text-muted-foreground">Son tarih</dt>
        <dd data-testid="ticket-due">
          {t.dueOn ? (
            t.overdue ? (
              <DueLabel dueOn={t.dueOn} overdue today={today} />
            ) : (
              formatLongDay(t.dueOn)
            )
          ) : (
            <span className="text-muted-foreground">Son tarih yok</span>
          )}
        </dd>
      </dl>
      <div className="space-y-1 border-t pt-2.5 text-xs text-muted-foreground">
        <p data-testid="ticket-opened">
          Açan: {t.createdBy.name} · {formatAuditDate(t.createdAt)}
        </p>
        {t.lastEdit && (
          <p data-testid="ticket-edited">
            Son değişiklik: {t.lastEdit.name} · {formatAuditDateTime(t.lastEdit.at)}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <TicketSeen number={t.number} eventId={t.seen.eventId} revision={t.seen.revision} />
      <BackLink href={`/yonetim?sutun=${SUTUN_SLUGS[t.status]}`}>Panoya dön</BackLink>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8">
        <header className="min-w-0 space-y-1 lg:col-start-1">
          <div className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
            <span data-testid="ticket-number">#{t.number}</span>
            <CopyLinkButton path={`/yonetim/${t.number}`} />
          </div>
          <h1 className="text-2xl leading-tight font-medium [overflow-wrap:anywhere] md:text-3xl">
            {t.title}
          </h1>
        </header>

        <aside className="space-y-4 self-start lg:sticky lg:top-10 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="flex flex-wrap gap-2 lg:grid lg:grid-cols-2">
            <MoveMenu number={t.number} status={t.status} variant="detail" />
            <Link
              href={`/yonetim/${t.number}/duzenle`}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 rounded-full px-4",
                !t.canDelete && "lg:col-span-2",
              )}
            >
              <Pencil />
              Düzenle
            </Link>
            {t.canDelete && <TicketDelete number={t.number} className="max-lg:hidden" />}
          </div>
          {facts}
        </aside>

        <div className="min-w-0 space-y-5 lg:col-start-1">
          {t.description && (
            <p
              data-testid="ticket-description"
              className="text-[15px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
            >
              {t.description}
            </p>
          )}

          <section aria-labelledby="akis" className="space-y-3">
            <h2 id="akis" className="flex items-baseline gap-2 text-xl font-medium">
              Akış
              {comments > 0 && (
                <span className="font-sans text-sm font-normal text-muted-foreground">
                  {comments} yorum
                </span>
              )}
            </h2>
            <ol className="space-y-3" data-testid="thread">
              {t.thread.map((e) =>
                e.kind === "system" ? (
                  <li
                    key={e.id}
                    data-kind="system"
                    className="flex items-start gap-2 py-1 pl-3 text-xs text-muted-foreground"
                  >
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
                    <p>
                      <span data-testid="system-text">{e.text}</span>{" "}
                      <time dateTime={e.at.toISOString()}>
                        · {formatShortDateTime.format(e.at)}
                      </time>
                    </p>
                  </li>
                ) : (
                  <li key={e.id} data-kind="comment" data-id={e.id} className="flex gap-3">
                    <UserAvatar name={e.author} className="size-8 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{e.author}</span>
                        <time
                          dateTime={e.at.toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {formatShortDateTime.format(e.at)}
                        </time>
                        <span className="ml-auto">
                          {e.canDelete && (
                            <CommentDelete
                              id={e.id}
                              label={`${e.author} yorumunu sil, ${formatShortDateTime.format(e.at)}: ${excerpt(e.body)}`}
                              expiresAt={e.at.getTime() + COMMENT_DELETE_WINDOW_S * 1000}
                            />
                          )}
                        </span>
                      </div>
                      <p
                        data-testid="comment-body"
                        className="rounded-2xl border bg-card p-3 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
                      >
                        {e.body}
                      </p>
                    </div>
                  </li>
                ),
              )}
            </ol>
          </section>
        </div>

        <div className="min-w-0 lg:col-start-1">
          <CommentForm number={t.number} initialKey={crypto.randomUUID()} />
          {t.canDelete && (
            <TicketDelete number={t.number} variant="end" className="mt-6 lg:hidden" />
          )}
        </div>
      </div>
    </div>
  );
}
