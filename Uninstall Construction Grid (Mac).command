#!/bin/bash
# Removes the Construction Grid panel. Leaves Adobe's PlayerDebugMode setting alone, because other
# unsigned panels you use may rely on it. Grids already drawn stay in your documents.
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.jro.constructiongrid"
echo "✓ Construction Grid removed. Restart Illustrator."
[ -t 0 ] && read -n 1 -s -r -p "Press any key to close…"; echo
