import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { AddToListModal } from "@/components/lists/add-to-list-modal";
import { CreateListModal } from "@/components/lists/create-list-modal";
import { listLists } from "@/lib/queries/audience";
import { formatDate, formatNumber } from "@/lib/utils";
import { requireAccess } from "@/lib/setup-gate";

export default async function ListsPage() {
  await requireAccess();
  const lists = await listLists();

  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Lists" className="justify-between">
        <CreateListModal />
      </PanelHeader>
      <PanelBody>
        {lists.length === 0 ? (
          <EmptyState
            title="No lists yet"
            description="A list groups contacts for a campaign. Membership is soft-deleted on unsubscribe rather than removed, so someone who re-subscribes keeps their history."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>List</Th>
                <Th>Slug</Th>
                <Th className="text-right">Members</Th>
                <Th className="text-right">Created</Th>
                <Th className="text-right">Contacts</Th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => (
                <Tr key={list.id}>
                  <Td>
                    <span className="block font-medium">{list.name}</span>
                    {list.description ? (
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {list.description}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {list.slug}
                    </code>
                  </Td>
                  <Td className="tabular text-right">{formatNumber(list.memberCount)}</Td>
                  <Td className="tabular text-right text-muted-foreground">
                    {formatDate(list.createdAt)}
                  </Td>
                  <Td className="text-right">
                    <AddToListModal listId={list.id} listName={list.name} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
