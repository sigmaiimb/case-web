"""Exploration script — run this first to understand PDF structure before extraction."""
import pdfplumber, json, sys

PDF = r"D:\CaseWeb\ICON IIMB Casebook 2025-26 Vol 15(a).pdf"

def explore(start=5, end=12):
    with pdfplumber.open(PDF) as pdf:
        for i in range(start - 1, min(end, len(pdf.pages))):
            page = pdf.pages[i]
            print(f"\n{'='*60}")
            print(f"PAGE {i+1}  size={page.width:.0f}x{page.height:.0f}")
            print(f"{'='*60}")

            # Raw words with positions
            words = page.extract_words(x_tolerance=3, y_tolerance=3, keep_blank_chars=False)
            for w in words[:80]:
                print(f"  x0={w['x0']:6.1f} top={w['top']:6.1f}  '{w['text']}'")

            # Full text
            print("\n--- FULL TEXT ---")
            print(page.extract_text() or "(empty)")

if __name__ == "__main__":
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    end   = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    explore(start, end)
