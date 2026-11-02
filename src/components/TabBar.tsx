import type { Video } from "../types";
import SourceIcon from "./SourceIcon";
import { CloseIcon } from "./icons";
import { displayTitle } from "../lib/display";

interface Props {
  tabs: Video[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length === 0) return null;
  return (
    <div className="tabbar" role="tablist" aria-label="Open videos">
      {tabs.map((v) => {
        const label = displayTitle(v);
        return (
        <div
          key={v.id}
          role="tab"
          aria-selected={v.id === activeId}
          title={label}
          tabIndex={0}
          className={"tab" + (v.id === activeId ? " active" : "")}
          onClick={() => onSelect(v.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(v.id);
            }
          }}
        >
          <SourceIcon source={v.source} size={15} />
          <span className="tabtitle">{label}</span>
          <button
            className="tabclose"
            aria-label={`Close ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(v.id);
            }}
          >
            <CloseIcon size={11} />
          </button>
        </div>
        );
      })}
    </div>
  );
}
