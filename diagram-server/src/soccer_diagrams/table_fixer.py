"""Fix alignment issues in ASCII tables within text files."""

from __future__ import annotations

import re
import textwrap
from pathlib import Path


# Box-drawing characters for table detection
BOX_VERTICAL = "│┃"
BOX_CORNERS_TOP = set("┌┐╭╮")
BOX_CORNERS_BOTTOM = set("└┘╯╰")
BOX_TEES_TOP = set("┬")
BOX_TEES_BOTTOM = set("┴")
BOX_TEES_LEFT = set("├")
BOX_TEES_RIGHT = set("┤")
BOX_CROSS = set("┼")
BOX_HORIZONTAL = set("─━┄┈╌")

# All characters that indicate column boundaries in border lines
BOX_COL_SEPARATORS = BOX_TEES_TOP | BOX_TEES_BOTTOM | BOX_CROSS | BOX_CORNERS_TOP | BOX_CORNERS_BOTTOM


def _is_table_border_line(line: str) -> bool:
    """Check if a line is a table border (top, bottom, or separator row)."""
    stripped = line.strip()
    if not stripped:
        return False
    first_char = stripped[0]
    # Border lines start with corner or left tee
    if first_char not in (BOX_CORNERS_TOP | BOX_CORNERS_BOTTOM | BOX_TEES_LEFT):
        return False
    # And contain mostly horizontal lines
    horizontal_count = sum(1 for c in stripped if c in BOX_HORIZONTAL)
    return horizontal_count > len(stripped) * 0.4


def _is_table_data_line(line: str) -> bool:
    """Check if a line is a table data row (contains │ separators)."""
    stripped = line.strip()
    if not stripped:
        return False
    # Data lines start and end with vertical bars
    return stripped[0] in BOX_VERTICAL and stripped[-1] in BOX_VERTICAL


def _get_column_positions(border_line: str) -> list[int]:
    """Extract column separator positions from a border line.

    Returns positions of all column separators (┬, ┼, ┴, corners).
    """
    positions = []
    for i, char in enumerate(border_line):
        if char in BOX_COL_SEPARATORS:
            positions.append(i)
    return positions


def _get_pipe_positions(data_line: str) -> list[int]:
    """Extract │ positions from a data line."""
    positions = []
    for i, char in enumerate(data_line):
        if char in BOX_VERTICAL:
            positions.append(i)
    return positions


def _fix_data_row(data_line: str, expected_positions: list[int]) -> tuple[str, list[str], list[str]]:
    """Fix a data row to align │ with expected column positions.

    Works left-to-right so fixing an interior column automatically
    shifts all subsequent columns into place.

    Returns (fixed_line, list_of_fixes, list_of_warnings).
    """
    actual_positions = _get_pipe_positions(data_line)

    if actual_positions == expected_positions:
        return data_line, [], []

    if len(actual_positions) != len(expected_positions):
        # Different number of columns - can't fix automatically
        return data_line, [], [f"column count mismatch: expected {len(expected_positions)}, got {len(actual_positions)}"]

    fixes = []
    warnings = []
    result_line = data_line
    cumulative_shift = 0  # Track how much we've shifted positions

    # Work left-to-right; fixing interior columns cascades to fix outer ones
    for i in range(len(expected_positions)):
        expected_pos = expected_positions[i]
        # Recalculate actual position accounting for previous fixes
        actual_pos = actual_positions[i] + cumulative_shift
        diff = expected_pos - actual_pos

        if diff == 0:
            continue

        if diff > 0:
            # Need to add spaces before this │
            result_line = result_line[:actual_pos] + ' ' * diff + result_line[actual_pos:]
            cumulative_shift += diff
            fixes.append(f"col {i+1}: added {diff} space(s)")
        else:
            # Need to remove spaces before this │
            # Find how many spaces exist before the pipe
            spaces_before = 0
            check_pos = actual_pos - 1
            while check_pos >= 0 and result_line[check_pos] == ' ':
                spaces_before += 1
                check_pos -= 1

            spaces_to_remove = min(abs(diff), spaces_before)
            if spaces_to_remove > 0:
                remove_start = actual_pos - spaces_to_remove
                result_line = result_line[:remove_start] + result_line[actual_pos:]
                cumulative_shift -= spaces_to_remove
                fixes.append(f"col {i+1}: removed {spaces_to_remove} space(s)")
            elif spaces_before == 0:
                # Can't fix - content is too long for column
                shortfall = abs(diff) - spaces_to_remove
                warnings.append(f"col {i+1}: content {shortfall} char(s) too long (manual fix needed)")

    return result_line, fixes, warnings


def fix_table_alignment(text: str) -> tuple[str, list[dict], list[dict]]:
    """Fix alignment issues in ASCII tables.

    Detects tables and ensures all data rows have │ at the same positions
    as the column separators in the border rows.

    Args:
        text: The text content to fix

    Returns:
        Tuple of (fixed_text, list of fixes applied, list of warnings for unfixable issues)
    """
    lines = text.split("\n")
    result = []
    all_fixes = []
    all_warnings = []
    i = 0

    while i < len(lines):
        line = lines[i]

        if _is_table_border_line(line):
            # Found a table - collect all lines until table ends
            table_lines = [(i, line)]

            # Get column positions from this border line
            col_positions = _get_column_positions(line)
            j = i + 1

            while j < len(lines):
                next_line = lines[j]
                if _is_table_border_line(next_line):
                    table_lines.append((j, next_line))
                    # Update column positions if this border has more detail
                    new_positions = _get_column_positions(next_line)
                    if len(new_positions) >= len(col_positions):
                        col_positions = new_positions
                    j += 1
                elif _is_table_data_line(next_line):
                    table_lines.append((j, next_line))
                    j += 1
                else:
                    # End of table
                    break

            # Now fix all data rows to match column positions
            for line_num, table_line in table_lines:
                if _is_table_data_line(table_line):
                    fixed_line, line_fixes, line_warnings = _fix_data_row(table_line, col_positions)
                    result.append(fixed_line)
                    if line_fixes:
                        all_fixes.append({
                            "line": line_num + 1,
                            "fixes": line_fixes,
                        })
                    if line_warnings:
                        all_warnings.append({
                            "line": line_num + 1,
                            "warnings": line_warnings,
                        })
                else:
                    result.append(table_line)

            i = j
        else:
            result.append(line)
            i += 1

    return "\n".join(result), all_fixes, all_warnings


def fix_text_file(
    input_path: str,
    output_path: str | None = None,
    in_place: bool = True,
) -> dict:
    """Fix table alignment in a text file.

    Args:
        input_path: Path to the input text file
        output_path: Optional output path. If None and in_place=True, overwrites input.
        in_place: If True and output_path is None, overwrite the input file.

    Returns:
        Dict with status, fixes applied, warnings, and paths.
    """
    with open(input_path, "r", encoding="utf-8") as f:
        original_text = f.read()

    fixed_text, fixes, warnings = fix_table_alignment(original_text)

    if not fixes and not warnings:
        return {
            "status": "no_changes",
            "input_path": input_path,
            "fixes": [],
            "warnings": [],
            "message": "No alignment issues found",
        }

    # Determine output path
    if output_path is None:
        if in_place:
            output_path = input_path
        else:
            p = Path(input_path)
            output_path = str(p.parent / (p.stem + "_fixed" + p.suffix))

    # Write fixed content (even if there are warnings, apply what we can)
    if fixes:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(fixed_text)

    total_fixes = sum(len(f["fixes"]) for f in fixes)
    total_warnings = sum(len(w["warnings"]) for w in warnings)

    status = "fixed" if fixes else "warnings_only"
    if fixes and warnings:
        status = "partial"

    messages = []
    if total_fixes:
        messages.append(f"Fixed {total_fixes} issue(s) on {len(fixes)} line(s)")
    if total_warnings:
        messages.append(f"{total_warnings} unfixable issue(s) on {len(warnings)} line(s) need manual attention")

    return {
        "status": status,
        "input_path": input_path,
        "output_path": output_path if fixes else None,
        "fixes": fixes,
        "warnings": warnings,
        "message": "; ".join(messages),
    }


def fix_all_text_files(
    directory: str,
    pattern: str = "*.txt",
    in_place: bool = True,
) -> list[dict]:
    """Fix table alignment in all matching text files in a directory.

    Args:
        directory: Directory containing text files
        pattern: Glob pattern for input files (default: *.txt)
        in_place: If True, overwrite files with fixes

    Returns:
        List of results for each file.
    """
    dir_path = Path(directory)
    results = []

    for txt_file in dir_path.glob(pattern):
        try:
            result = fix_text_file(str(txt_file), in_place=in_place)
            results.append(result)
        except Exception as e:
            results.append({
                "status": "error",
                "input_path": str(txt_file),
                "error": str(e),
            })

    return results


def _get_max_table_width(text: str) -> int:
    """Find the maximum width of any table in the text."""
    max_width = 0
    for line in text.split("\n"):
        if _is_table_border_line(line) or _is_table_data_line(line):
            max_width = max(max_width, len(line))
    return max_width


def _get_line_indent(line: str) -> str:
    """Extract the leading whitespace from a line."""
    stripped = line.lstrip()
    return line[:len(line) - len(stripped)]


def wrap_long_lines(
    text: str,
    max_width: int | None = None,
) -> tuple[str, list[dict]]:
    """Wrap long non-table lines to fit within max_width.

    Args:
        text: The text content to process
        max_width: Maximum line width. If None, uses the widest table in the text.

    Returns:
        Tuple of (wrapped_text, list of changes made)
    """
    if max_width is None:
        max_width = _get_max_table_width(text)
        if max_width == 0:
            # No tables found, use a reasonable default
            max_width = 120

    lines = text.split("\n")
    result = []
    changes = []

    for i, line in enumerate(lines):
        # Skip table lines - don't wrap those
        if _is_table_border_line(line) or _is_table_data_line(line):
            result.append(line)
            continue

        # Skip empty lines
        if not line.strip():
            result.append(line)
            continue

        # Check if line needs wrapping
        if len(line) <= max_width:
            result.append(line)
            continue

        # Get indent for continuation lines
        indent = _get_line_indent(line)
        content = line.strip()

        # Handle special prefixes (bullets, list items)
        prefix_match = re.match(r'^([-*●├└]\s*|[0-9]+\.\s*)', content)
        if prefix_match:
            prefix = prefix_match.group(1)
            content = content[len(prefix):]
            subsequent_indent = indent + ' ' * len(prefix)
        else:
            prefix = ''
            subsequent_indent = indent

        # Calculate available width for content
        first_line_width = max_width - len(indent) - len(prefix)
        subsequent_width = max_width - len(subsequent_indent)

        if first_line_width < 20 or subsequent_width < 20:
            # Not enough room to wrap meaningfully
            result.append(line)
            continue

        # Wrap the content
        wrapped = textwrap.wrap(
            content,
            width=first_line_width,
            subsequent_indent='',
            break_long_words=False,
            break_on_hyphens=True,
        )

        if len(wrapped) <= 1:
            # Couldn't wrap (maybe a single long word)
            result.append(line)
            continue

        # Build wrapped lines
        result.append(indent + prefix + wrapped[0])
        for wrap_line in wrapped[1:]:
            # Re-wrap subsequent lines to their width
            rewrapped = textwrap.wrap(
                wrap_line,
                width=subsequent_width,
                break_long_words=False,
                break_on_hyphens=True,
            )
            for rw in rewrapped:
                result.append(subsequent_indent + rw)

        changes.append({
            "line": i + 1,
            "original_length": len(line),
            "wrapped_to": len(wrapped) + sum(len(textwrap.wrap(w, width=subsequent_width)) - 1 for w in wrapped[1:]),
        })

    return "\n".join(result), changes


def format_text_file(
    input_path: str,
    output_path: str | None = None,
    in_place: bool = True,
    max_width: int | None = None,
) -> dict:
    """Fix table alignment AND wrap long lines in a text file.

    Args:
        input_path: Path to the input text file
        output_path: Optional output path. If None and in_place=True, overwrites input.
        in_place: If True and output_path is None, overwrite the input file.
        max_width: Maximum line width for wrapping. If None, uses widest table.

    Returns:
        Dict with status, fixes, wraps, warnings, and paths.
    """
    with open(input_path, "r", encoding="utf-8") as f:
        original_text = f.read()

    # First fix table alignment
    fixed_text, table_fixes, table_warnings = fix_table_alignment(original_text)

    # Then wrap long lines
    wrapped_text, wrap_changes = wrap_long_lines(fixed_text, max_width)

    if not table_fixes and not table_warnings and not wrap_changes:
        return {
            "status": "no_changes",
            "input_path": input_path,
            "table_fixes": [],
            "table_warnings": [],
            "line_wraps": [],
            "message": "No changes needed",
        }

    # Determine output path
    if output_path is None:
        if in_place:
            output_path = input_path
        else:
            p = Path(input_path)
            output_path = str(p.parent / (p.stem + "_formatted" + p.suffix))

    # Write formatted content
    if table_fixes or wrap_changes:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(wrapped_text)

    messages = []
    if table_fixes:
        total_fixes = sum(len(f["fixes"]) for f in table_fixes)
        messages.append(f"Fixed {total_fixes} table alignment issue(s)")
    if table_warnings:
        total_warnings = sum(len(w["warnings"]) for w in table_warnings)
        messages.append(f"{total_warnings} unfixable table issue(s)")
    if wrap_changes:
        messages.append(f"Wrapped {len(wrap_changes)} long line(s)")

    return {
        "status": "formatted",
        "input_path": input_path,
        "output_path": output_path if (table_fixes or wrap_changes) else None,
        "table_fixes": table_fixes,
        "table_warnings": table_warnings,
        "line_wraps": wrap_changes,
        "message": "; ".join(messages),
    }
