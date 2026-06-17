package clog

import (
	"fmt"
	"strings"
)

// Row is one line in a Panel: a label, a value, and an ANSI color for the value.
type Row struct {
	Label string
	Value string
	Color string // value color (e.g. clog.BrightGreen); "" for default
}

// R is a shorthand constructor for a Row.
func R(label, value, color string) Row { return Row{Label: label, Value: value, Color: color} }

// Panel renders a titled, bordered box with aligned label/value rows. Borders
// and title use the accent color; values use each row's own color. Width math
// is done on the *plain* text so ANSI codes never break alignment.
func Panel(accent, title string, rows []Row) string {
	labelW := 0
	for _, r := range rows {
		if n := len(r.Label); n > labelW {
			labelW = n
		}
	}
	// inner content width (before side padding): "label  value"
	inner := len(title)
	for _, r := range rows {
		if w := labelW + 2 + len(r.Value); w > inner {
			inner = w
		}
	}
	const pad = 1 // spaces inside the border on each side
	width := inner + pad*2

	var b strings.Builder
	bar := func(s string) { b.WriteString(C(accent, s)) }

	// top: ╭─ TITLE ─────╮
	dashes := width - (len(title) + 3) // 1 lead dash + 2 spaces around title
	if dashes < 1 {
		dashes = 1
	}
	bar("╭")
	bar("─")
	b.WriteString(" " + C(Bold+accent, title) + " ")
	bar(strings.Repeat("─", dashes))
	bar("╮")
	b.WriteByte('\n')

	// rows
	for _, r := range rows {
		bar("│")
		b.WriteString(strings.Repeat(" ", pad))
		label := r.Label + strings.Repeat(" ", labelW-len(r.Label))
		b.WriteString(C(Gray, label))
		b.WriteString("  ")
		b.WriteString(C(r.Color, r.Value))
		// right padding to align the closing border
		used := labelW + 2 + len(r.Value)
		b.WriteString(strings.Repeat(" ", inner-used+pad))
		bar("│")
		b.WriteByte('\n')
	}

	// bottom
	bar("╰")
	bar(strings.Repeat("─", width))
	bar("╯")
	b.WriteByte('\n')
	return b.String()
}

// Banner returns a small colored startup banner for the given component.
func Banner(component, version string) string {
	art := []string{
		`   __  __                       ____`,
		`  / / / /___  ____  ___  __  __ / __ )___  ___`,
		` / /_/ / __ \/ __ \/ _ \/ / / // __  / _ \/ _ \`,
		`/ __  / /_/ / / / /  __/ /_/ // /_/ /  __/  __/`,
		`\_/ /_/\____/_/ /_/\___/\__, //_____/\___/\___/`,
		`                       /____/`,
	}
	var b strings.Builder
	for _, line := range art {
		b.WriteString(C(BrightYellow, line))
		b.WriteByte('\n')
	}
	b.WriteString(C(Gray, "  honeybee-enhanced "))
	b.WriteString(C(Bold+BrightCyan, component))
	b.WriteString(C(Gray, fmt.Sprintf("  ·  %s", version)))
	b.WriteByte('\n')
	return b.String()
}
