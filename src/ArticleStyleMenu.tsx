import { useEffect, useRef, useState } from "react";
const styles = [
  { value: "p", label: "Paragraph", detail: "Normal text" },
  { value: "h2", label: "Heading 2", detail: "Larger bold text" },
  { value: "h3", label: "Heading 3", detail: "Medium bold text" },
  { value: "blockquote", label: "Quote", detail: "Italic text" },
];
export default function ArticleStyleMenu({
  value,
  disabled,
  rememberSelection,
  onChange,
}: {
  value: string;
  disabled: boolean;
  rememberSelection: () => void;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    styles.findIndex((style) => style.value === value),
  );
  useEffect(() => {
    if (!open) return;
    options.current[selected]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div className="article-style-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="article-style-trigger"
        aria-label="Paragraph style"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="article-style-options"
        disabled={disabled}
        onPointerDown={rememberSelection}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            rememberSelection();
            setOpen(true);
          }
        }}
      >
        {styles[selected].label}
        <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      {open && (
        <div
          className="article-style-options"
          id="article-style-options"
          role="listbox"
          aria-label="Paragraph style"
          onKeyDown={(event) => {
            const index = options.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % styles.length
                : event.key === "ArrowUp"
                  ? (index + styles.length - 1) % styles.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? styles.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              options.current[next]?.focus();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
            if (event.key === "Tab") setOpen(false);
          }}
        >
          {styles.map((style, index) => (
            <button
              type="button"
              role="option"
              aria-selected={value === style.value}
              className={`article-style-option style-${style.value}`}
              key={style.value}
              ref={(element) => {
                options.current[index] = element;
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(style.value);
                setOpen(false);
              }}
            >
              <span>
                <strong>{style.label}</strong>
                <small>{style.detail}</small>
              </span>
              {value === style.value && (
                <span className="article-style-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
