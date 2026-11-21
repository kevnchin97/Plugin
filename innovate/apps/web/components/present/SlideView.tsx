"use client";
import type { SlideInput } from "@innovate/shared";
import { MotionMedia, type MediaLike } from "@/components/media/MotionMedia";

export type SlideMedia = MediaLike & { id: string; title: string };

interface Props {
  slide: SlideInput;
  media: Record<string, SlideMedia | undefined>;
  theme: "paper" | "night";
  deckTitle: string;
  /** Plays GIFs and clips (presenting, or the slide being edited). */
  playing: boolean;
  /** Editing: heading/body become fields, media slots are buttons. */
  edit?: {
    onChange(patch: Partial<SlideInput>): void;
    onSlotClick(index: number): void;
    activeSlot: number | null;
  };
}

/**
 * One 16:9 slide, sized with container-query units so the same component renders the editor,
 * the thumbnails, the presenter and the share link identically. Theme maps onto the app tokens.
 */
export function SlideView({ slide, media, theme, deckTitle, playing, edit }: Props) {
  const ids = slide.mediaIds;
  const slot = (i: number, className = "") => {
    const m = ids[i] ? media[ids[i]] : undefined;
    const content = m ? (
      <MotionMedia item={m} active={playing} fit="cover" />
    ) : edit ? (
      <span className="grid h-full w-full place-items-center text-[1.4cqw] text-text-faint">+ Add a reference</span>
    ) : null;
    if (!edit) return <div key={i} className={`relative overflow-hidden bg-player ${className}`} data-testid="slide-media">{content}</div>;
    return (
      <button
        key={i}
        type="button"
        onClick={() => edit.onSlotClick(i)}
        aria-label={m ? `Media ${i + 1}: ${m.title}. Replace or remove` : `Media slot ${i + 1}: add a reference`}
        className={`relative overflow-hidden bg-player ${edit.activeSlot === i ? "outline-[0.3cqw] outline-accent outline-solid" : "hover:outline-[0.2cqw] hover:outline-accent-line hover:outline-solid"} ${className}`}
        data-testid="slide-slot"
      >
        {content}
      </button>
    );
  };

  const heading = (cls: string, placeholder: string) =>
    edit ? (
      <textarea
        value={slide.heading}
        onChange={(e) => edit.onChange({ heading: e.target.value })}
        placeholder={placeholder}
        aria-label="Slide heading"
        rows={1}
        className={`field-sizing-content w-full resize-none bg-transparent font-semibold text-text outline-none placeholder:text-text-faint ${cls}`}
      />
    ) : (
      <h2 className={`font-semibold whitespace-pre-wrap text-text ${cls}`}>{slide.heading}</h2>
    );
  const body = (cls: string, placeholder = "Write something…") =>
    edit ? (
      <textarea
        value={slide.body}
        onChange={(e) => edit.onChange({ body: e.target.value })}
        placeholder={placeholder}
        aria-label="Slide text"
        className={`field-sizing-content w-full resize-none bg-transparent text-text-muted outline-none placeholder:text-text-faint ${cls}`}
      />
    ) : (
      <p className={`whitespace-pre-wrap text-text-muted ${cls}`}>{slide.body}</p>
    );

  const gridCount = Math.max(edit ? Math.min(ids.length + 1, 6) : ids.length, 1);
  const cols = gridCount <= 2 ? gridCount : gridCount <= 4 ? 2 : 3;
  const overImage = (slide.layout === "title" && ids[0]) || slide.layout === "media";

  return (
    <div data-theme={theme === "night" ? "dark" : "light"} className="@container relative aspect-video w-full overflow-hidden bg-bg text-text" data-testid="slide">
      {slide.layout === "title" &&
        (ids[0] ? (
          <>
            <div className="absolute inset-0">{slot(0, "h-full w-full")}</div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />
            <div className="absolute inset-x-[5cqw] bottom-[5cqw] [&_*]:text-white [&_p]:text-white/80">
              {heading("text-[4.6cqw] leading-[1.05] tracking-[-0.02em]", deckTitle)}
              <div className="mt-[1cqw]">{body("text-[1.7cqw]", "Subtitle")}</div>
            </div>
          </>
        ) : (
          <div className="absolute inset-[6cqw] flex flex-col justify-center">
            <div className="mb-[2cqw] h-[0.35cqw] w-[4cqw] bg-accent" />
            {heading("text-[5cqw] leading-[1.05] tracking-[-0.02em]", deckTitle)}
            <div className="mt-[1.4cqw]">{body("text-[1.8cqw]", "Subtitle")}</div>
            {edit && (
              <button type="button" onClick={() => edit.onSlotClick(0)} className="mt-[2cqw] self-start text-[1.2cqw] text-accent hover:underline">
                + Background image
              </button>
            )}
          </div>
        ))}

      {slide.layout === "text" && (
        <div className="absolute inset-x-[10cqw] inset-y-[9cqw] flex flex-col">
          {heading("text-[3.4cqw] leading-tight tracking-[-0.01em]", "Heading")}
          <div className="mt-[2cqw] min-h-0 flex-1">{body("text-[1.9cqw] leading-relaxed")}</div>
        </div>
      )}

      {slide.layout === "media" && (
        <>
          <div className="absolute inset-0">{slot(0, "h-full w-full")}</div>
          {(slide.heading || edit) && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-[5cqw] pt-[6cqw] pb-[3cqw] [&_*]:text-white">
              {heading("text-[2.2cqw]", "Caption (optional)")}
            </div>
          )}
        </>
      )}

      {slide.layout === "media-text" && (
        <div className="absolute inset-0 grid grid-cols-[56%_1fr]">
          <div className={`grid min-h-0 gap-[0.8cqw] ${ids.length > 1 ? "grid-rows-2" : ""}`}>
            {slot(0, "h-full w-full")}
            {(ids.length > 1 || (edit && ids.length === 1)) && slot(1, "h-full w-full")}
          </div>
          <div className="flex min-h-0 flex-col px-[4cqw] pt-[6cqw]">
            {heading("text-[2.8cqw] leading-tight tracking-[-0.01em]", "Heading")}
            <div className="mt-[1.6cqw] min-h-0 flex-1">{body("text-[1.6cqw] leading-relaxed")}</div>
          </div>
        </div>
      )}

      {slide.layout === "grid" && (
        <div className="absolute inset-[5cqw] flex flex-col">
          <div className="mb-[2cqw] grid grid-cols-[45%_1fr] gap-[4cqw]">
            {heading("text-[2.6cqw] leading-tight tracking-[-0.01em]", "Heading")}
            {body("text-[1.4cqw] leading-relaxed")}
          </div>
          <div className="grid min-h-0 flex-1 gap-[0.8cqw]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: "1fr" }}>
            {Array.from({ length: gridCount }, (_, i) => slot(i, "h-full w-full"))}
          </div>
        </div>
      )}

      <div className={`pointer-events-none absolute top-[2cqw] left-[5cqw] text-[0.95cqw] tracking-[0.08em] uppercase ${overImage ? "text-white/70" : "text-text-faint"}`}>
        {deckTitle}
      </div>
    </div>
  );
}
