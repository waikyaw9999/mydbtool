"use client";

import { useEffect, useState, type MouseEvent } from "react";

import type { Engine } from "@/lib/connections/types";
import type { SchemaNode } from "@/lib/db/types";

export type TreePath = {
  kind: SchemaNode["kind"];
  name: string;
  database?: string;
  schema?: string;
  table?: string;
  collection?: string;
};

export type ObjectMenuAction =
  | "createTable"
  | "dropTable"
  | "renameTable"
  | "addColumn"
  | "dropColumn"
  | "createCollection"
  | "dropCollection"
  | "renameCollection";

type MenuItem = {
  id: ObjectMenuAction;
  label: string;
  danger?: boolean;
};

type Props = {
  nodes: SchemaNode[];
  engine: Engine;
  readOnly?: boolean;
  onOpen: (path: TreePath) => void;
  onExpandDatabase?: (name: string) => void;
  onSelectDatabase?: (name: string) => void;
  onAction?: (action: ObjectMenuAction, path: TreePath) => void;
  activeDatabase?: string;
};

export function ObjectTree({
  nodes,
  engine,
  readOnly,
  onOpen,
  onExpandDatabase,
  onSelectDatabase,
  onAction,
  activeDatabase,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: TreePath } | null>(null);

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (nodes.length === 0) {
    return (
      <div style={{ color: "var(--muted)", padding: "12px 8px", fontSize: 12.5 }}>
        No objects found for this connection.
      </div>
    );
  }

  const items = menu ? menuItemsFor(engine, menu.path) : [];

  return (
    <div>
      {nodes.map((node) => (
        <TreeItem
          key={`${node.kind}:${node.name}`}
          node={node}
          depth={0}
          engine={engine}
          onOpen={onOpen}
          onExpandDatabase={onExpandDatabase}
          onSelectDatabase={onSelectDatabase}
          activeDatabase={activeDatabase}
          onMenu={(event, path) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY, path });
          }}
        />
      ))}
      {menu && items.length > 0 ? (
        <div
          className="context-menu"
          role="menu"
          style={{
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 260)),
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 200)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {readOnly ? (
            <div className="context-menu-note">Read-only connection</div>
          ) : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : undefined}
              disabled={readOnly}
              onClick={() => {
                onAction?.(item.id, menu.path);
                setMenu(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function menuItemsFor(engine: Engine, path: TreePath): MenuItem[] {
  if (engine === "mongo") {
    if (path.kind === "database") return [{ id: "createCollection", label: "New collection" }];
    if (path.kind === "collection") {
      return [
        { id: "renameCollection", label: "Rename collection" },
        { id: "dropCollection", label: "Drop collection", danger: true },
      ];
    }
    return [];
  }
  if (path.kind === "database" || path.kind === "schema") {
    return [{ id: "createTable", label: "New table" }];
  }
  if (path.kind === "table") {
    return [
      { id: "renameTable", label: "Rename table" },
      { id: "addColumn", label: "Add column" },
      { id: "dropColumn", label: "Drop column", danger: true },
      { id: "dropTable", label: "Drop table", danger: true },
    ];
  }
  if (path.kind === "view") {
    return [{ id: "dropTable", label: "Drop view", danger: true }];
  }
  return [];
}

function TreeItem({
  node,
  depth,
  parents,
  engine,
  onOpen,
  onExpandDatabase,
  onSelectDatabase,
  onMenu,
  activeDatabase,
}: {
  node: SchemaNode;
  depth: number;
  parents?: { database?: string; schema?: string };
  engine: Engine;
  onOpen: Props["onOpen"];
  onExpandDatabase?: (name: string) => void;
  onSelectDatabase?: (name: string) => void;
  onMenu: (event: MouseEvent, path: TreePath) => void;
  activeDatabase?: string;
}) {
  const isLeaf = node.kind === "table" || node.kind === "view" || node.kind === "collection";
  const [open, setOpen] = useState(
    node.kind === "database"
      ? (node.children?.length ?? 0) > 0 && depth < 1
      : depth < 1 || node.kind === "schema",
  );
  const nextParents = {
    database: node.kind === "database" ? node.name : parents?.database,
    schema: node.kind === "schema" ? node.name : parents?.schema,
  };
  const path: TreePath = {
    kind: node.kind,
    name: node.name,
    ...nextParents,
    table: node.kind === "table" || node.kind === "view" ? node.name : undefined,
    collection: node.kind === "collection" ? node.name : undefined,
  };
  const isCurrentDatabase = node.kind === "database" && Boolean(activeDatabase) && node.name === activeDatabase;
  const hasMenu = menuItemsFor(engine, path).length > 0;

  function toggle() {
    if (isLeaf) {
      onOpen(path);
      return;
    }
    const willOpen = !open;
    setOpen(willOpen);
    if (node.kind === "database") {
      onSelectDatabase?.(node.name);
      if (willOpen && (node.children?.length ?? 0) === 0) {
        onExpandDatabase?.(node.name);
      }
    }
  }

  return (
    <div>
      <div className="tree-row">
        <button
          type="button"
          className={`tree-node ${isLeaf ? "leaf" : ""} ${isCurrentDatabase ? "current" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={toggle}
          onContextMenu={hasMenu ? (event) => onMenu(event, path) : undefined}
        >
          <span style={{ width: 12, color: "var(--faint)" }}>
            {isLeaf ? "·" : open ? "▾" : "▸"}
          </span>
          <KindMark kind={node.kind} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
        </button>
        {hasMenu ? (
          <button
            type="button"
            className="tree-more"
            aria-label={`Actions for ${node.name}`}
            aria-haspopup="menu"
            onClick={(event) => onMenu(event, path)}
          >
            ⋮
          </button>
        ) : null}
      </div>
      {open && node.children?.length
        ? node.children.map((child) => (
            <TreeItem
              key={`${child.kind}:${child.name}`}
              node={child}
              depth={depth + 1}
              parents={nextParents}
              engine={engine}
              onOpen={onOpen}
              onExpandDatabase={onExpandDatabase}
              onSelectDatabase={onSelectDatabase}
              onMenu={onMenu}
              activeDatabase={activeDatabase}
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
