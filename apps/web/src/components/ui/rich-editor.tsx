"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Heading2,
  ImagePlus,
  Heading3,
  Italic,
  Link2,
  List,
  Loader2,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { EmojiPicker } from "./emoji-picker";
import { cn } from "@/lib/utils";

/**
 * A small rich-text editor for composing email.
 *
 * Deliberately not a general-purpose editor: it offers the marks that survive
 * the trip into a mail client and nothing else. Tables, colours, fonts and
 * images are all things that either break in Outlook or need inline styling
 * gymnastics to work, and an editor that lets you build something the
 * recipient cannot see is worse than one that does not.
 */
export function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  autoFocus,
  className,
  bodyClassName,
  toolbarExtra,
  onImageUpload,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string, text: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /**
   * The writing area's accessible name.
   *
   * It cannot come from a `<label for>` like every other control in the app:
   * the editor is a `contenteditable` div, and `for` only binds to labelable
   * elements. Without this the message body is announced as an unnamed text
   * box sitting under a heading.
   */
  ariaLabel?: string;
  /** Overrides the writing area's height. A reply is a few lines; a new
   *  message in a modal has room, and should use it. */
  bodyClassName?: string;
  /** Renders alongside the built-in tools, with the live editor in hand.
   *  Callers extend the toolbar this way rather than holding a ref to the
   *  editor, so there is one owner of the instance and no window in which a
   *  ref is read before the editor exists. */
  toolbarExtra?: (editor: Editor) => ReactNode;
  /**
   * Stores an image and returns the URL to embed. Absent, the image button is
   * not shown — a composer with nowhere to put a file should not offer one.
   */
  onImageUpload?: (file: File) => Promise<string | null>;
}) {
  const editor = useEditor({
    // Next renders this on the server first; without the flag React warns about
    // the DOM the editor builds during hydration.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Email has no use for a code block, and a horizontal rule renders
        // inconsistently enough that offering it is a trap.
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      /**
       * Images are referenced by URL, never inlined as a data: URI. Gmail and
       * Outlook both strip those, so an inlined image looks right in the
       * composer and arrives as a broken box.
       *
       * The width attribute is what keeps a 3000px photo from arriving as a
       * 3000px photo — mail clients honour the attribute where they ignore
       * much of the CSS.
       */
      Image.configure({
        inline: false,
        HTMLAttributes: { style: "max-width:100%;height:auto", width: "560" },
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          "prose-email overflow-y-auto scroll-subtle",
          "px-1.5 py-1 text-[13px] leading-relaxed outline-none",
          bodyClassName ?? "min-h-[72px] max-h-56",
        ),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => {
      // Both forms are handed up: the HTML is what gets sent, and the plain
      // text is the alternative part every message needs to avoid looking
      // spam-like to a filter.
      onChange(instance.getHTML(), instance.getText());
    },
    onBlur: () => onBlur?.(),
  });

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus("end");
  }, [autoFocus, editor]);

  if (!editor) {
    // Reserve the space the editor will occupy so the composer does not jump.
    return <div className={cn("min-h-[72px]", className)} />;
  }

  return (
    <div className={className}>
      <Toolbar
        editor={editor}
        extra={toolbarExtra}
        {...(onImageUpload ? { onImageUpload } : {})}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  extra,
  onImageUpload,
}: {
  editor: Editor;
  extra?: (editor: Editor) => ReactNode;
  onImageUpload?: (file: File) => Promise<string | null>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b pb-1.5">
      <Tool
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </Tool>
      <Tool
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </Tool>
      <Tool
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </Tool>

      <Divider />

      <Tool
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-3.5" />
      </Tool>
      <Tool
        label="Subheading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-3.5" />
      </Tool>

      <Divider />

      <Tool
        label="Bulleted list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </Tool>
      <Tool
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </Tool>
      <Tool
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-3.5" />
      </Tool>

      <Divider />

      <Tool
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Link to");
          if (!url) return;
          // Only http(s). A `javascript:` href in an email is either a mistake
          // or an attack, and neither is worth supporting.
          if (!/^https?:\/\//i.test(url)) {
            window.alert("Links must start with http:// or https://");
            return;
          }
          editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        <Link2 className="size-3.5" />
      </Tool>

      {onImageUpload ? <ImageTool editor={editor} upload={onImageUpload} /> : null}

      <EmojiPicker onPick={(emoji) => editor.chain().focus().insertContent(emoji).run()} />

      {extra?.(editor)}

      <div className="ml-auto flex items-center gap-0.5">
        <Tool
          label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="size-3.5" />
        </Tool>
        <Tool
          label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="size-3.5" />
        </Tool>
      </div>
    </div>
  );
}

function Tool({
  label,
  active,
  children,
  ...props
}: React.ComponentProps<"button"> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Buttons in a form default to submitting it; a toolbar that sends the
      // email when you click Bold would be memorable for the wrong reason.
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Uploads an image and drops it in at the cursor.
 *
 * Separate from `Tool` because it owns a hidden file input and a pending state
 * — the upload is a round trip, and a toolbar button that looks idle while a
 * 3MB photo is in flight invites a second click and a second copy.
 */
function ImageTool({
  editor,
  upload,
}: {
  editor: Editor;
  upload: (file: File) => Promise<string | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;

          setBusy(true);
          void upload(file)
            .then((url) => {
              if (url) editor.chain().focus().setImage({ src: url, alt: file.name }).run();
            })
            .finally(() => setBusy(false));
        }}
      />
      <Tool
        label="Insert image"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
      </Tool>
    </>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
}
