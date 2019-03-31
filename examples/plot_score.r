#!/usr/bin/env Rscript --vanilla
# Generates an image showing the score distribution of all scorers.
# Usage: ./plot_score.r <json> <png>

library('rjson')
library('ggplot2')
library('data.table')
pdf(NULL) # Don't generate a PDF file

formatValue <- function(v) {
  if (is.numeric(v)) {
    return(signif(round(v[[1]], 1), 3))
  } else if (is.character(v)) {
    return(substr(v[[1]], 0, 5))
  }
  return(v[[1]])
}

summarise <- function(attribute, scores, values) {
  min_index <- which.min(scores)
  max_index <- which.max(scores)
  min_value <- formatValue(values[[min_index]])
  max_value <- formatValue(values[[max_index]])
  return(data.table(
    attr=attribute,
    score=c(scores[[min_index]], scores[[max_index]]),
    value=c(
      if(is.null(min_value)) 'null' else min_value,
      if(is.null(max_value)) 'null' else max_value
    )
  ))
}

# Create data tables
f <- file('stdin')
json <- fromJSON(file=f)
scores <- data.table(attr='consolidated', score=json$consolidated$scores)
summary <- NULL
for (s in json$scorers) {
  if (length(s$scores) > 0) {
    scores <- rbind(scores, data.table(attr=s$attribute, score=s$scores))
    summary <- rbind(summary, summarise(s$attribute, s$scores, s$values))
  }
}

# Plot and export
ggplot(scores,
  aes(
    x=factor(attr, levels=rev(unique(attr))),
    y=score,
    fill=attr,
    label=score
  )
) +
  theme_minimal() +
  geom_violin(alpha=.7, bw=0.05, adjust=1/2, trim=FALSE) +
  geom_label(data=summary, size=2.8, nudge_x=.25, alpha=.7, aes(label=value)) +
  coord_flip() +
  theme(
    legend.position='none',
    legend.title=element_blank(),
    axis.title.y=element_blank()
  )
ggsave(
  'score.png',
  width=6.7,
  height=(length(json$scorers) + 1) * .6,
  dpi=320,
  limitsize=FALSE
)
