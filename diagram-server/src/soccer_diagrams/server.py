"""MCP server for soccer tactical diagrams and PDF generation."""

from __future__ import annotations

import json
import os
from dataclasses import asdict

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .evaluator import evaluate_session
from .pdf_builder import compile_pdf
from .renderer import render
from .schema import DrillDefinition
from .table_fixer import fix_text_file, format_text_file
from .text_to_pdf import text_to_pdf, batch_text_to_pdf

server = Server("soccer-diagrams")

# Resolve output paths relative to project root (two levels up from this file)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DIAGRAMS_DIR = os.path.join(PROJECT_ROOT, "output", "diagrams")
PDFS_DIR = os.path.join(PROJECT_ROOT, "output", "pdfs")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="render_tactical_diagram",
            description=(
                "Render a soccer tactical diagram from a DrillDefinition. "
                "Draws a pitch with players, movement arrows, and zones using mplsoccer. "
                "Returns the path to the saved image."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "drill": {
                        "type": "object",
                        "description": "DrillDefinition object with meta, elements, actions, zones",
                    },
                    "format": {
                        "type": "string",
                        "enum": ["png", "pdf"],
                        "default": "png",
                        "description": "Output image format",
                    },
                },
                "required": ["drill"],
            },
        ),
        Tool(
            name="evaluate_session_plan",
            description=(
                "Evaluate spatial and intensity metrics for a session plan. "
                "Calculates area-per-player for each activity and provides recommendations. "
                "Thresholds: <20m²=very tight, 20-50=possession, 50-100=game-like, "
                "100-200=transitions, >200=fitness."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "pitch_length": {"type": "number", "description": "Pitch length in meters"},
                    "pitch_width": {"type": "number", "description": "Pitch width in meters"},
                    "num_players": {"type": "integer", "description": "Total number of players"},
                    "activities": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "area_length": {"type": "number"},
                                "area_width": {"type": "number"},
                                "num_players": {"type": "integer"},
                                "duration_minutes": {"type": "number"},
                                "intensity": {"type": "string", "enum": ["low", "medium", "high"]},
                            },
                            "required": ["name"],
                        },
                        "description": "List of activities in the session",
                    },
                },
                "required": ["pitch_length", "pitch_width", "num_players", "activities"],
            },
        ),
        Tool(
            name="compile_to_pdf",
            description=(
                "Compile a session plan with text and images into a PDF document. "
                "Accepts markdown text sections and image paths. Returns the PDF file path."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "PDF document title"},
                    "sections": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["markdown", "image"],
                                },
                                "content": {
                                    "type": "string",
                                    "description": "Markdown text or image file path",
                                },
                                "caption": {
                                    "type": "string",
                                    "description": "Optional caption for images",
                                },
                            },
                            "required": ["type", "content"],
                        },
                        "description": "Ordered list of content sections",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Optional output file path. Defaults to output/pdfs/",
                    },
                },
                "required": ["title", "sections"],
            },
        ),
        Tool(
            name="text_to_pdf",
            description=(
                "Convert a fixed-width text file to PDF with exact formatting preservation. "
                "Uses a monospace font to maintain alignment of tables and ASCII art. "
                "Automatically adjusts font size if lines are too long, and switches to "
                "landscape mode if needed. Won't overwrite existing files - adds version "
                "numbers instead (e.g., file_v1.pdf, file_v2.pdf)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "input_path": {
                        "type": "string",
                        "description": "Path to the input text file",
                    },
                    "output_path": {
                        "type": "string",
                        "description": (
                            "Optional output path. If not specified, uses the same name "
                            "with .pdf extension in the output/ folder."
                        ),
                    },
                },
                "required": ["input_path"],
            },
        ),
        Tool(
            name="fix_table_alignment",
            description=(
                "Fix alignment issues in ASCII tables within a text file. "
                "Detects tables using box-drawing characters and ensures all data rows "
                "match the width of border rows by adding or removing padding. "
                "Call this after generating text files with tables to fix any misalignment. "
                "By default, fixes the file in place."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "input_path": {
                        "type": "string",
                        "description": "Path to the text file to fix",
                    },
                    "in_place": {
                        "type": "boolean",
                        "default": True,
                        "description": "If true, overwrite the input file. If false, create a new file with '_fixed' suffix.",
                    },
                },
                "required": ["input_path"],
            },
        ),
        Tool(
            name="format_text_file",
            description=(
                "Format a text file by fixing table alignment AND wrapping long lines. "
                "Tables are aligned to match border widths. Non-table lines longer than "
                "the widest table are wrapped to fit. Reports unfixable issues (like "
                "content too long for columns) that need manual attention."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "input_path": {
                        "type": "string",
                        "description": "Path to the text file to format",
                    },
                    "in_place": {
                        "type": "boolean",
                        "default": True,
                        "description": "If true, overwrite the input file. If false, create a new file with '_formatted' suffix.",
                    },
                    "max_width": {
                        "type": "integer",
                        "description": "Maximum line width. If not specified, uses the widest table in the file.",
                    },
                },
                "required": ["input_path"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "render_tactical_diagram":
        drill = DrillDefinition.model_validate(arguments["drill"])
        fmt = arguments.get("format", "png")
        image_path = render(drill, fmt=fmt, output_dir=DIAGRAMS_DIR)
        return [TextContent(
            type="text",
            text=json.dumps({"image_path": image_path, "title": drill.meta.title}),
        )]

    elif name == "evaluate_session_plan":
        result = evaluate_session(
            pitch_length=arguments["pitch_length"],
            pitch_width=arguments["pitch_width"],
            num_players=arguments["num_players"],
            activities=arguments["activities"],
        )
        output = {
            "activities": [asdict(a) for a in result.activities],
            "overall_recommendations": result.overall_recommendations,
            "intensity_profile": result.intensity_profile,
        }
        return [TextContent(type="text", text=json.dumps(output, indent=2))]

    elif name == "compile_to_pdf":
        output_path = arguments.get("output_path")
        if output_path is None:
            # Use default dir
            pdf_path = compile_pdf(
                title=arguments["title"],
                sections=arguments["sections"],
            )
        else:
            pdf_path = compile_pdf(
                title=arguments["title"],
                sections=arguments["sections"],
                output_path=output_path,
            )
        return [TextContent(
            type="text",
            text=json.dumps({"pdf_path": pdf_path}),
        )]

    elif name == "text_to_pdf":
        input_path = arguments["input_path"]
        # Resolve relative paths against project output directory
        if not os.path.isabs(input_path):
            input_path = os.path.join(OUTPUT_DIR, input_path)

        output_path = arguments.get("output_path")
        if output_path is None:
            # Default: same name with .pdf in output folder
            input_name = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(OUTPUT_DIR, input_name + ".pdf")
        elif not os.path.isabs(output_path):
            output_path = os.path.join(OUTPUT_DIR, output_path)

        result_path = text_to_pdf(input_path, output_path)
        return [TextContent(
            type="text",
            text=json.dumps({"pdf_path": result_path, "input_path": input_path}),
        )]

    elif name == "fix_table_alignment":
        input_path = arguments["input_path"]
        if not os.path.isabs(input_path):
            input_path = os.path.join(OUTPUT_DIR, input_path)

        in_place = arguments.get("in_place", True)
        result = fix_text_file(input_path, in_place=in_place)
        return [TextContent(
            type="text",
            text=json.dumps(result, indent=2),
        )]

    elif name == "format_text_file":
        input_path = arguments["input_path"]
        if not os.path.isabs(input_path):
            input_path = os.path.join(OUTPUT_DIR, input_path)

        in_place = arguments.get("in_place", True)
        max_width = arguments.get("max_width")
        result = format_text_file(input_path, in_place=in_place, max_width=max_width)
        return [TextContent(
            type="text",
            text=json.dumps(result, indent=2),
        )]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
