#!/usr/bin/env python3
import sys
import pdfplumber
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    
    try:
        text_content = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                # Use standard extraction with loose tolerances per spec
                text = page.extract_text(x_tolerance=3, y_tolerance=3)
                if not text:
                    # Fallback to simple extraction if layout detection fails
                    text = page.extract_text_simple()
                
                if text:
                    text_content.append(text)
        
        full_text = "\n\n".join(text_content)
        
        # Output strictly as JSON so Rust can easily parse it
        print(json.dumps({
            "success": True,
            "text": full_text
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
