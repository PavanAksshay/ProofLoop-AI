import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface ThemeSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const ThemeSelect: React.FC<ThemeSelectProps> = ({
  id,
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Hidden native select for full accessibility and test compatibility */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="sr-only"
        tabIndex={-1}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Sharp Architectural Trigger Button - Theme Matched */}
      <button
        type="button"
        id={`${id}-trigger`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={id}
        className={`w-full flex items-center justify-between text-left px-3 py-2 text-xs font-mono transition-colors border ${
          disabled
            ? 'bg-[#EAE3D7] border-[#DFD7C7] text-[#827869] cursor-not-allowed opacity-65'
            : isOpen
            ? 'bg-[#FAF6F0] border-[#0E7490] text-[#1C1917] ring-1 ring-[#0E7490]'
            : 'bg-[#ECE6DC] border-[#D5CAB9] text-[#1C1917] hover:bg-[#E6DFD4] hover:border-[#B5A895] cursor-pointer'
        }`}
      >
        <span className="pr-2 font-medium whitespace-normal break-words leading-snug">
          {selectedOption ? selectedOption.label : value}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#575044] flex-shrink-0 transition-transform duration-200 mt-0.5 ${
            isOpen ? 'rotate-180 text-[#0E7490]' : ''
          }`}
        />
      </button>

      {/* Sharp Custom Popup Menu - Warm Architectural Canvas (No OS Dark Bubble) */}
      {isOpen && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className="absolute z-50 left-0 right-0 top-full mt-1 bg-[#FAF6F0] border border-[#1C1917] shadow-xl max-h-72 overflow-y-auto divide-y divide-[#DFD7C7] animate-in fade-in-0 zoom-in-95 duration-100 min-w-full"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                className={`p-2.5 text-xs font-mono cursor-pointer transition-colors flex items-center justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-[#1C1917] text-[#FAF6F0] font-bold'
                    : 'bg-[#FAF6F0] text-[#1C1917] hover:bg-[#ECE6DC] hover:text-[#0E7490]'
                }`}
              >
                <div className="flex flex-col gap-1 pr-2 whitespace-normal break-words leading-snug">
                  <span className="break-words">{opt.label}</span>
                  {opt.description && (
                    <span
                      className={`text-[10px] font-sans font-normal break-words ${
                        isSelected ? 'text-[#DFD7C7]' : 'text-[#6B6255]'
                      }`}
                    >
                      {opt.description}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 flex-shrink-0 text-cyan-400" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
