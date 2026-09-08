"use client";

import React, { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Heading3,
  ListOrdered, List, Indent, Outdent, Link2, Undo2, Redo2, Link2Off,
} from "lucide-react";

/**
 * The rich-text block behind the reference's campaign brief toolbar: bold,
 * italic, underline, strikethrough, heading levels, both list styles, indent
 * and outdent, and a link.
 *
 * The editor is also the reader. Content arrives as an HTML string and is
 * parsed through the editor's schema, which keeps only the marks and nodes the
 * toolbar can produce -- a script tag, an event-handler attribute or a
 * javascript: href has nowhere in that schema to land, and the link extension
 * rejects a disallowed protocol in its own parse. Nothing here reaches
 * dangerouslySetInnerHTML, which is why the stored HTML does not need a
 * separate sanitiser. A second reader that renders the string directly would.
 *
 * Read-only mode reuses the same editor rather than a second render path, so
 * what a viewer sees is exactly what the schema accepted.
 */

type Props = {
  value: string;
  editable?: boolean;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  ariaLabel?: string;
};

/**
 * The reference shows four heading buttons, three of which announce themselves
 * as "Subtitle". Three levels, each named for what it does, is the same
 * capability without the ambiguity.
 */
const HEADINGS = [
  { level: 1 as const, label: "Title", Icon: Heading1 },
  { level: 2 as const, label: "Subtitle", Icon: Heading2 },
  { level: 3 as const, label: "Heading 3", Icon: Heading3 },
];

function ToolButton({
  label, active, disabled, onClick, children,
}: {
  label: string; active?: boolean; disabled?: boolean;
  onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Pressing a toolbar button must not move focus off the text. It used to,
      // and the chained focus() that put it back landed a tick later -- so
      // clicking Bold and typing straight away lost the first character to
      // nowhere. Refusing the focus in the first place means there is nothing
      // to restore and no window to lose a keystroke in.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        width: 28, height: 24, display: "inline-flex", alignItems: "center",
        justifyContent: "center", borderRadius: 6, cursor: disabled ? "default" : "pointer",
        border: "none",
        background: active ? "var(--cc-primary)" : "transparent",
        color: disabled
          ? "var(--cc-text-subtle)"
          : active ? "white" : "var(--cc-text-muted)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

const Divider = () => (
  <span aria-hidden style={{ width: 1, height: 16, background: "var(--cc-border)", margin: "0 4px" }} />
);

function Toolbar({ editor }: { editor: Editor }) {
  // A link needs a URL, and a URL needs somewhere to type it. The row appears
  // under the toolbar rather than in a prompt() so it can be reached by
  // keyboard and cancelled with Escape.
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  const openLink = () => {
    setHref(editor.getAttributes("link").href ?? "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = href.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };

  const I = { width: 15, height: 15 };

  return (
    <div style={{ borderBottom: "1px solid var(--cc-border)", padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0 }}>
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 {...I} />
        </ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 {...I} />
        </ToolButton>

        <Divider />

        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold {...I} />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic {...I} />
        </ToolButton>
        <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline {...I} />
        </ToolButton>
        <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough {...I} />
        </ToolButton>

        <Divider />

        {HEADINGS.map(({ level, label, Icon }) => (
          <ToolButton
            key={level}
            label={label}
            active={editor.isActive("heading", { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <Icon {...I} />
          </ToolButton>
        ))}

        <Divider />

        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered {...I} />
        </ToolButton>
        <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List {...I} />
        </ToolButton>

        <Divider />

        {/* Indenting is nesting a list item -- the only indent the document
            model has. Both are disabled outside a list, where they would do
            nothing. */}
        <ToolButton
          label="Remove indent"
          disabled={!editor.can().liftListItem("listItem")}
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
        >
          <Outdent {...I} />
        </ToolButton>
        <ToolButton
          label="Indent"
          disabled={!editor.can().sinkListItem("listItem")}
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
        >
          <Indent {...I} />
        </ToolButton>

        <Divider />

        <ToolButton label="Link" active={editor.isActive("link")} onClick={openLink}>
          <Link2 {...I} />
        </ToolButton>
        {editor.isActive("link") && (
          <ToolButton label="Remove link" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Link2Off {...I} />
          </ToolButton>
        )}
      </div>

      {linkOpen && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            autoFocus
            value={href}
            aria-label="Link URL"
            placeholder="https://"
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); }
            }}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 8, fontSize: 13,
              border: "1px solid var(--cc-border)", background: "var(--cc-card)",
              color: "var(--cc-text)",
            }}
          />
          <button
            type="button"
            onClick={applyLink}
            style={{
              padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 13,
              fontWeight: 600, background: "var(--cc-primary)", color: "white", cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

export default function RichTextEditor({
  value, editable = true, onChange, placeholder, minHeight = 140, ariaLabel,
}: Props) {
  const editor = useEditor({
    // The editor renders on the client only; rendering it on the server and
    // again on the client is what produces a hydration mismatch here.
    immediatelyRender: false,
    editable,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: value,
    editorProps: {
      attributes: {
        class: "cc-prose",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        style: `min-height:${minHeight}px;padding:12px 14px;outline:none`,
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML()),
  });

  /**
   * While editable, the editor owns its content: `value` is where it starts,
   * not something reapplied on every render.
   *
   * Writing `value` back in was the first attempt, and it ate text. A parent
   * holding the HTML in state hands each onUpdate straight back as the next
   * value; anything typed between emitting and re-rendering was then
   * overwritten by the older copy, which swallowed the first stretch of every
   * sentence -- "Hook in the first two seconds." arrived as "st two seconds.".
   * Guarding the comparison only narrowed the race. Not syncing at all while
   * someone is typing closes it.
   *
   * Read-only has no typing to race with, so it does follow `value`.
   */
  useEffect(() => {
    if (!editor || editable) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editable, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) {
    return (
      <div
        style={{
          border: "1px solid var(--cc-border)", borderRadius: 10,
          minHeight: minHeight + 37, background: "var(--cc-card)",
        }}
      />
    );
  }

  const empty = editor.isEmpty;

  return (
    <div
      style={{
        border: editable ? "1px solid var(--cc-border)" : "none",
        borderRadius: 10,
        background: editable ? "var(--cc-card)" : "transparent",
      }}
    >
      {editable && <Toolbar editor={editor} />}
      <div style={{ position: "relative" }}>
        <EditorContent editor={editor} />
        {empty && placeholder && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: editable ? 12 : 0, left: editable ? 15 : 0,
              fontSize: 14, color: "var(--cc-text-muted)", pointerEvents: "none",
            }}
          >
            {placeholder}
          </span>
        )}
      </div>
    </div>
  );
}
