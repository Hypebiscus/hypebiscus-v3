export function RangeBar({
	min,
	max,
	current,
	xBalance = 0,
	yBalance = 0,
}: {
	min: number
	max: number
	current: number
	xBalance?: number
	yBalance?: number
}) {
	const currentPercent = ((current - min) / (max - min)) * 100

	// Determine position type with threshold for dust amounts
	const DUST_THRESHOLD = 0.000001
	const isSingleSided = (xBalance < DUST_THRESHOLD && yBalance >= DUST_THRESHOLD) || (xBalance >= DUST_THRESHOLD && yBalance < DUST_THRESHOLD)
	const isXOnly = xBalance >= DUST_THRESHOLD && yBalance < DUST_THRESHOLD // X token only (e.g., BTC)
	const isYOnly = yBalance >= DUST_THRESHOLD && xBalance < DUST_THRESHOLD // Y token only (e.g., SOL)

	// Determine if out of range based on position type
	let isOutOfRange = false

	if (isSingleSided) {
		if (isXOnly) {
			// X token only: price dropped below range (all liquidity converted to X)
			// Out of range when current price is BELOW minimum
			isOutOfRange = current < min
		} else if (isYOnly) {
			// Y token only: price rose above range (all liquidity converted to Y)
			// Out of range when current price is ABOVE maximum
			isOutOfRange = current > max
		}
	} else {
		// Dual-sided: active from min to max
		// Out of range when outside this range
		isOutOfRange = current < min || current > max
	}

	// Clamp the display percentage to 0-100 range
	let displayPercent = currentPercent
	if (current <= min) {
		displayPercent = 0
	} else if (current >= max) {
		displayPercent = 100
	}

	// Adjust transform based on position to prevent overflow
	let indicatorTransform = 'translateX(-50%)'
	if (displayPercent === 0) {
		indicatorTransform = 'translateX(0%)' // Align to left edge
	} else if (displayPercent === 100) {
		indicatorTransform = 'translateX(-100%)' // Align to right edge
	}

	return (
		<div className="w-full max-w-xs mt-2">
			{/* Out of Range Indicator */}
			{isOutOfRange && (
				<div className="text-xs font-semibold text-yellow-500 mb-1 flex items-center gap-1">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
					</svg>
					Out of Range
				</div>
			)}

			<div className="flex justify-between text-xs text-white mb-1">
				<span>${min.toFixed(2)}</span>
				<span>${max.toFixed(2)}</span>
			</div>
			<div className="relative h-3 flex items-center">
				<div className="absolute left-0 right-0 h-1 bg-gray-300 rounded" />
				{/* Center vertical line */}
				<div
					className="absolute z-10"
					style={{
						left: '50%',
						top: '-4px',
						height: '20px',
						width: '3px',
						background: '#3fff3f',
						borderRadius: '2px',
						transform: 'translateX(-50%)',
					}}
				/>
				<div className="absolute h-1 bg-primary rounded left-0 right-0" />
				<div
					className="absolute top-0 w-1 h-3 bg-yellow-400 rounded"
					style={{ left: `${displayPercent}%`, transform: indicatorTransform }}
				/>
			</div>
		</div>
	)
}
