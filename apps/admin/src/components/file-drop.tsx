// FileDrop (docs/06 §5.3): a drop zone with a real file button. Type and size are checked before anything is sent,
// and a problem is announced next to the field.
import { type DragEvent, type ReactNode, useState } from "react";
import { Upload } from "./icons.tsx";
import { FieldError } from "./ui.tsx";

export function FileDrop(props: {
  id: string;
  label: string;
  hint: ReactNode;
  accept: string[];
  maxBytes: number;
  onFile: (f: File) => void;
  optional?: boolean | undefined;
}) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(f: File | undefined) {
    if (!f) return;
    if (!props.accept.includes(f.type)) {
      setError("That file type isn't accepted. Use one of the types listed above.");
      return;
    }
    if (f.size > props.maxBytes) {
      setError(`That file is too big. The limit is ${Math.round(props.maxBytes / 1024)} KB.`);
      return;
    }
    setError(null);
    props.onFile(f);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };

  return (
    <div className="field">
      <span className="label-like" id={`${props.id}-label`}>
        {props.label}
        {props.optional && <span className="field__optional"> (optional)</span>}
      </span>
      <p className="hint" id={`${props.id}-hint`}>
        {props.hint}
      </p>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the button inside is the control */}
      <div
        className="filedrop"
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Upload />
        <span className="filedrop__text">Drop a file here, or</span>
        <label className="btn btn--secondary filedrop__btn">
          Choose a file
          <input
            id={props.id}
            type="file"
            className="visually-hidden"
            accept={props.accept.join(",")}
            aria-labelledby={`${props.id}-label`}
            aria-describedby={[`${props.id}-hint`, error ? `${props.id}-error` : ""]
              .filter(Boolean)
              .join(" ")}
            onChange={(e) => take(e.target.files?.[0])}
          />
        </label>
      </div>
      {error && <FieldError id={`${props.id}-error`}>{error}</FieldError>}
    </div>
  );
}
