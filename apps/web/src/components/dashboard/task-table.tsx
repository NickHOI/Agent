import Link from "next/link";
import { ArrowUpRight, GitBranch } from "lucide-react";
import type { TaskRecord } from "@donelayer/database";
import { StatusBadge } from "@/components/ui/status";
import { formatCurrency, formatRelativeTime, humanize, taskStatusTone } from "@/lib/format";

export function TaskTable({ tasks }: { tasks: TaskRecord[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[#2a2e36] text-[11px] font-semibold uppercase text-[#666e7a]">
            <th className="px-4 py-3">Task</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Budget</th>
            <th className="px-4 py-3">Updated</th>
            <th className="w-12 px-4 py-3"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#242831]">
          {tasks.map((task) => (
            <tr key={task.id} className="group bg-[#111318] transition-colors hover:bg-[#15181e]">
              <td className="max-w-sm px-4 py-3.5">
                <Link href={`/tasks/${task.id}`} className="focus-ring block rounded-[3px]">
                  <span className="block truncate text-sm font-semibold text-white group-hover:text-[#8fc2ff]">{task.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-[#666e7a]"><GitBranch className="size-3" /> {task.repository.replace("demo://", "")}</span>
                </Link>
              </td>
              <td className="px-4 py-3.5 text-xs text-[#b2b8c2]">{humanize(task.taskType)}</td>
              <td className="px-4 py-3.5"><StatusBadge label={humanize(task.status)} tone={taskStatusTone(task.status)} compact /></td>
              <td className="px-4 py-3.5 text-sm font-medium text-white">{formatCurrency(task.budgetCents)}</td>
              <td className="px-4 py-3.5 text-xs text-[#969da8]">{formatRelativeTime(task.updatedAt)}</td>
              <td className="px-4 py-3.5 text-[#666e7a]"><ArrowUpRight className="size-4 group-hover:text-[#8fc2ff]" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
