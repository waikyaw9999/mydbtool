"use client";

import { useState } from "react";

import type { SchemaNode } from "@/lib/db/types";

type Props = {
  nodes: SchemaNode[];
  onOpen: (path: { database?: string; schema?: string; table?: string; collection?: string; kind: SchemaNode["kind"] }) => void;
  onExpandDatabase?: (name: string) => void;
};

export function ObjectTree({ nodes, onOpen, onExpandDatabase }: Props) {
  if (nodes.length === 0) {
    return (
      <div style={{ color: "var(--muted)", padding: "12px 8px", fontSize: 12.5 }}>
        No objects found for this connection.
      </div>
    );
  }
  return (
    <div>
      {nodes.map((node) => (
        <TreeItem
          key={`${node.kind}:${node.name}`}
          node={node}
          depth={0}
          onOpen={onOpen}
          onExpandDatabase={onExpandDatabase}
        />
      ))}
    </div>
  );
}

function TreeItem({
  node,
  depth,
  parents,
  onOpen,
  onExpandDatabase,
}: {
  node: SchemaNode;
  depth: number;
  parents?: { database?: string; schema?: string };
  onOpen: Props["onOpen"];
  onExpandDatabase?: (name: string) => void;
}) {
  const isLeaf = node.kind === "table" || node.kind === "view" || node.kind === "collection";
  const [open, setOpen] = useState(depth < 1 || node.kind === "schema");
  const nextParents = {
    database: node.kind === "database" ? node.name : parents?.database,
    schema: node.kind === "schema" ? node.name : parents?.schema,
  };

  function toggle() {
    if (isLeaf) {
      onOpen({
        ...nextParents,
        table: node.kind === "table" || node.kind === "view" ? node.name : undefined,
        collection: node.kind === "collection" ? node.name : undefined,
        kind: node.kind,
      });
      return;
    }
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && node.kind === "database" && (node.children?.length ?? 0) === 0) {
      onExpandDatabase?.(node.name);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={`tree-node ${isLeaf ? "leaf" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={toggle}
      >
        <span style={{ width: 12, color: "var(--faint)" }}>
          {isLeaf ? "·" : open ? "▾" : "▸"}
        </span>
        <KindMark kind={node.kind} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
      </button>
      {open && node.children?.length
        ? node.children.map((child) => (
            <TreeItem
              key={`${child.kind}:${child.name}`}
              node={child}
              depth={depth + 1}
              parents={nextParents}
              onOpen={onOpen}
              onExpandDatabase={onExpandDatabase}
            />
          ))
        : null}
    </div>
  );
}

function KindMark({ kind }: { kind: SchemaNode["kind"] }) {
  const label =
    kind === "database" ? "DB" : kind === "schema" ? "SC" : kind === "collection" ? "CL" : kind === "view" ? "VW" : "TB";
  return (
    <span className="chip" style={{ fontSize: 10, minWidth: 28, justifyContent: "center" }}>
      {label}
    </span>
  );
}
