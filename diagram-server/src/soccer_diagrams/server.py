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
from .html_pdf_builder import compile_pdf_html, compile_html
from .renderer import render
from .schema import DrillDefinition

server = Server("soccer-diagrams")

# Resolve output paths relative to project root (two levels up from this file)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DIAGRAMS_DIR = os.path.join(PROJECT_ROOT, "output", "diagrams")
PDFS_DIR = os.path.join(PROJECT_ROOT, "output", "pdfs")


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
                "Accepts markdown text sections and image paths. Returns the PDF file path. "
                "Use renderer='html' (default) for better table and formatting support, "
                "or renderer='reportlab' for the legacy renderer."
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
                    "renderer": {
                        "type": "string",
                        "enum": ["html", "reportlab"],
                        "default": "html",
                        "description": "PDF renderer: 'html' (better formatting/tables) or 'reportlab' (legacy)",
                    },
                },
                "required": ["title", "sections"],
            },
        ),
        Tool(
            name="compile_to_html",
            description=(
                "Compile a session plan with text and images into a standalone HTML document. "
                "Accepts markdown text sections and image paths. Images are embedded as base64. "
                "Returns the HTML file path."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "HTML document title"},
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
                        "description": "Optional output file path. Defaults to output/html/",
                    },
                },
                "required": ["title", "sections"],
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
        renderer = arguments.get("renderer", "html")

        # Select the appropriate compiler based on renderer
        if renderer == "html":
            compiler = compile_pdf_html
        else:
            compiler = compile_pdf

        pdf_path = compiler(
            title=arguments["title"],
            sections=arguments["sections"],
            output_path=output_path,
        )
        return [TextContent(
            type="text",
            text=json.dumps({"pdf_path": pdf_path}),
        )]

    elif name == "compile_to_html":
        output_path = arguments.get("output_path")
        html_path = compile_html(
            title=arguments["title"],
            sections=arguments["sections"],
            output_path=output_path,
        )
        return [TextContent(
            type="text",
            text=json.dumps({"html_path": html_path}),
        )]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
