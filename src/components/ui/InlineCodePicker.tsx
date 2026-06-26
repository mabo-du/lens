/**
 * InlineCodePicker — a searchable code picker for toolbars and dialogs.
 *
 * Unlike FuzzyCodePicker (which is dialog-based and tied to Ctrl+K +
 * text selection), this component renders as a compact button that opens
 * a Popover with a searchable Command list. Designed for inline use in
 * toolbars where a full dialog would be disruptive.
 *
 * Used by: AudioAnnotationView, ImageViewer, CodeDialog.
 */
import { useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag, ChevronsUpDown } from 'lucide-react';

interface InlineCodePickerProps {
  codes: { id: string; name: string; color: string }[];
  selectedCodeId: string;
  onSelect: (codeId: string) => void;
  /** Forwarded to the trigger button as the HTML id attribute (a11y). */
  id?: string;
}

export function InlineCodePicker({ codes, selectedCodeId, onSelect, id }: InlineCodePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = codes.find((c) => c.id === selectedCodeId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className="flex items-center gap-1.5 px-2 py-1 text-xs border rounded bg-white hover:bg-slate-50 transition-colors max-w-[180px]"
      >
        {selected ? (
          <>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
              style={{ backgroundColor: selected.color }}
            />
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          <>
            <Tag className="w-3 h-3 text-slate-400" />
            <span className="text-slate-400">Select code…</span>
          </>
        )}
        <ChevronsUpDown className="w-3 h-3 text-slate-400 ml-auto shrink-0" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[240px]" align="start">
        <Command>
          <CommandInput placeholder="Search codes…" />
          <CommandList>
            <CommandEmpty>No codes found.</CommandEmpty>
            <CommandGroup heading="Codes">
              {codes.map((code) => (
                <CommandItem
                  key={code.id}
                  value={code.name}
                  onSelect={() => {
                    onSelect(code.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: code.color }}
                  />
                  <span className="truncate">{code.name}</span>
                  {code.id === selectedCodeId && (
                    <span className="ml-auto text-[10px] text-blue-500 font-medium">active</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
