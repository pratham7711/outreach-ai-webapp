import { creatorNameParts } from "@/lib/creators/creatorName";

type Props = {
  name: string | null | undefined;
  handle: string | null | undefined;
  /** "stack" puts the handle under the name; "inline" beside it. */
  layout?: "stack" | "inline";
  size?: "sm" | "md" | "lg";
  /** For text on the dark gradient over a post thumbnail. */
  tone?: "default" | "overlay";
  className?: string;
};

/** A creator's name with their @handle, the same way on every screen. */
export default function CreatorName({ name, handle, layout = "stack", size = "md", tone = "default", className }: Props) {
  const p = creatorNameParts(name, handle);
  return (
    <span className={className ? `cc-creator-name ${className}` : "cc-creator-name"} data-layout={layout} data-size={size} data-tone={tone}>
      <span className="cc-creator-name-main" title={p.name}>
        {p.name}
      </span>
      {p.handle && (
        <span className="cc-creator-name-handle" title={p.handle}>
          {" "}
          {p.handle}
        </span>
      )}
    </span>
  );
}
