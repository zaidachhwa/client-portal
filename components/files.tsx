"use client";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, FileText, Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import type { ProjectView } from "@/lib/data";
import { UploadButton } from "./documents";
import { Badge, Card, CardHeader, Empty, SearchField, Segmented, ease, fileSize } from "./ui";

const kinds = ["All", "Docs", "Images", "Audio"] as const;
const kindOf = (mime: string) => (mime.startsWith("image/") ? "Images" : mime.startsWith("audio/") ? "Audio" : "Docs");
const icons = { Images: ImageIcon, Audio: AudioLines, Docs: FileText };

export function Files({ project, canUpload, className = "" }: { project: ProjectView; canUpload: boolean; className?: string }) {
  const [kind, setKind] = useState<(typeof kinds)[number]>("All");
  const [q, setQ] = useState("");
  const shown = project.files.filter((f) => (kind === "All" || kindOf(f.mime) === kind) && f.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Card id="files" className={className}>
      <CardHeader
        title="Project Files"
        sub="Our shared uploads are securely stored."
        action={canUpload && <UploadButton projectId={project.id} label="Upload a file" variant="solid" />}
      />
      <div className="mb-2 space-y-3">
        <SearchField size="sm" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search files" placeholder="Search files" />
        <Segmented id="file-kind" label="File type" options={kinds} value={kind} onChange={setKind} />
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((f) => {
            const Icon = icons[kindOf(f.mime)];
            return (
              <motion.li
                key={f.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease }}
                className="border-b border-line last:border-0"
              >
                <a
                  href={`/files/${f.id}`}
                  download
                  className="flex items-center gap-3 rounded-lg px-1 py-3 text-[12px] transition-colors duration-150 hover:bg-white/50"
                >
                  <Icon size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                  {f.version > 1 && <span className="shrink-0 text-[10px] tabular-nums text-muted">v{f.version}</span>}
                  {f.status === "pending_review" && <Badge tone="amber">In review</Badge>}
                  {f.status === "rejected" && <Badge tone="rose">Rejected</Badge>}
                  <span className="w-14 shrink-0 text-right font-medium tabular-nums">{fileSize(f.size)}</span>
                </a>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {shown.length === 0 && <Empty>No files match.</Empty>}
      </ul>
    </Card>
  );
}
