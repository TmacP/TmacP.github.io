#!/bin/bash

# Paths to the header and footer template files
HEADER_TEMPLATE="header-template.html"
FOOTER_TEMPLATE="footer-template.html"

# Directory where your source HTML files are located
HTML_SOURCE_DIR="."

# Directory where the generated HTML files will be stored
HTML_OUTPUT_DIR="./docs"


# Read the contents of the header and footer template files
HEADER_CONTENT=$(<"$HEADER_TEMPLATE")
FOOTER_CONTENT=$(<"$FOOTER_TEMPLATE")

# Function to process HTML files
process_html_files() {
    local SOURCE_DIR=$1
    local OUTPUT_DIR=$2
    local BASE_SOURCE_DIR=$3  # Base directory to calculate relative path

    # Find and process each HTML file in the source directory
    find "$SOURCE_DIR" -name "*.html" -type f | while read FILE; do
        # Skip the header and footer template files
        if [[ "$FILE" == "$BASE_SOURCE_DIR/$HEADER_TEMPLATE" || "$FILE" == "$BASE_SOURCE_DIR/$FOOTER_TEMPLATE" ]]; then
            continue
        fi

        # Read the HTML file content
        HTML_CONTENT=$(<"$FILE")

        # Adjust header content based on the file location
        if [[ "$SOURCE_DIR" == "$BASE_SOURCE_DIR/blog" ]]; then
            ADJUSTED_HEADER=$(echo "$HEADER_CONTENT" | sed 's|href="/|href="../|g; s|src="/|src="../|g')
        else
            ADJUSTED_HEADER=$HEADER_CONTENT
        fi
        
        # Replace the placeholders with the actual template content
        HTML_CONTENT="${HTML_CONTENT/<!-- header-template -->/$ADJUSTED_HEADER}"
        HTML_CONTENT="${HTML_CONTENT/<!-- footer-template -->/$FOOTER_CONTENT}"
        
        # Get the relative path and output file path
        RELATIVE_PATH="${FILE#$BASE_SOURCE_DIR/}"
        OUTPUT_FILE="$OUTPUT_DIR/$RELATIVE_PATH"

        # Ensure the output directory exists
        mkdir -p "$(dirname "$OUTPUT_FILE")"
        
        # Write the updated HTML content to the output directory
        echo "$HTML_CONTENT" > "$OUTPUT_FILE"
    done
}

# Process the root HTML files
process_html_files "$HTML_SOURCE_DIR" "$HTML_OUTPUT_DIR" "$HTML_SOURCE_DIR"

# Process the blog directory separately
process_html_files "$HTML_SOURCE_DIR/blog" "$HTML_OUTPUT_DIR" "$HTML_SOURCE_DIR"

echo "HTML files have been updated with header and footer templates and saved to $HTML_OUTPUT_DIR."
