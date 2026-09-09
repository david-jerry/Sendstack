"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ListSearch } from "@/components/shell/list-search";
import { LoadMore } from "@/components/shell/load-more";
import { PanelBody } from "@/components/shell/panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { useCursorList } from "@/hooks/use-cursor-list";
import type { Page } from "@/lib/cursor";
import type { ContactRow } from "@/lib/queries/audience";
import { DateText } from "@/components/ui/time";

const TONE = {
  active: "success",
  unsubscribed: "neutral",
  bounced: "danger",
  complained: "danger",
} as const;

type ContactDto = Omit<ContactRow, "createdAt"> & { createdAt: string };

/**
 * The contacts table, paged and searched from the client.
 *
 * Search used to be a form that reloaded the page through `?q=`, and the list
 * was a bare `LIMIT 200` — so an audience of any size had contacts nobody
 * could reach from the UI at all. The term still lives in the URL, so a
 * filtered view is linkable and the server renders the same first page the
 * client would fetch; what changed is that typing no longer costs a
 * navigation, and there is a way to the 201st person.
 */
export function ContactsPanel({ initialPage }: { initialPage: Page<ContactRow> }) {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();

  const seeded = q
    ? undefined
    : {
        items: initialPage.items as unknown as ContactDto[],
        nextCursor: initialPage.nextCursor,
      };

  const list = useCursorList<ContactDto>({
    key: ["contacts"],
    path: "/api/contacts",
    params: { q: q || undefined },
    ...(seeded ? { initialPage: seeded } : {}),
  });

  const contacts = useMemo<ContactRow[]>(
    () => list.items.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
    [list.items],
  );

  return (
    <>
      <div className="border-b px-4 py-2.5">
        <ListSearch
          placeholder="Search name, address, company, role or phone"
          busy={list.refreshing}
          className="max-w-[360px]"
        />
      </div>

      <PanelBody>
        {list.error ? (
          <div className="px-4 py-6 text-center">
            <p className="text-[12px] text-destructive">{list.error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {contacts.length === 0 && !list.loading && !list.error ? (
          <EmptyState
            title={q ? `No contacts match “${q}”` : "No contacts yet"}
            description={
              q
                ? "Try a shorter term, or part of an address."
                : "Import a CSV or add people one at a time. Use Add contact to create a person and assign groups in one step."
            }
          />
        ) : list.error ? null : (
          <Table>
            <thead>
              <tr>
                <Th>Contact</Th>
                <Th>Company</Th>
                <Th>Position</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th>Groups</Th>
                <Th className="text-right">Lists</Th>
                <Th className="text-right">Added</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const name =
                  [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
                return (
                  <Tr key={contact.id}>
                    <Td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={name} email={contact.email} size={26} />
                        <div className="min-w-0">
                          <span className="block truncate font-medium">
                            {name ?? contact.email}
                          </span>
                          {name ? (
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {contact.email}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-muted-foreground">
                      {contact.company ?? <span className="text-muted-foreground/50">-</span>}
                    </Td>
                    <Td className="text-muted-foreground">
                      {contact.position ?? <span className="text-muted-foreground/50">-</span>}
                    </Td>
                    <Td className="text-muted-foreground">
                      {contact.phone ?? <span className="text-muted-foreground/50">-</span>}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={TONE[contact.status]}>{contact.status}</Badge>
                        {/* A contact can read "active" while their address sits
                            on the suppression list — from an import after a
                            bounce, say. Surfacing both is what stops someone
                            wondering why an "active" contact never receives
                            anything. */}
                        {contact.suppressed && contact.status === "active" ? (
                          <Badge tone="danger">suppressed</Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {contact.groupNames.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {contact.groupNames.slice(0, 2).map((groupName) => (
                            <Badge key={`${contact.id}-${groupName}`} tone="neutral">
                              {groupName}
                            </Badge>
                          ))}
                          {contact.groupCount > 2 ? (
                            <Badge tone="neutral">+{contact.groupCount - 2}</Badge>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </Td>
                    <Td className="tabular text-right text-muted-foreground">
                      {contact.listCount}
                    </Td>
                    <Td className="tabular text-right text-muted-foreground">
                      <DateText value={contact.createdAt} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <LoadMore
          hasMore={list.hasMore}
          loading={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
          label="Load more contacts"
        />
      </PanelBody>
    </>
  );
}
