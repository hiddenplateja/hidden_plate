-- Both participants can read a block; only the blocker can change it.
create policy "blocks participant read" on public.blocks for select to authenticated
using (blocker_id = auth.uid() or blocked_id = auth.uid());
