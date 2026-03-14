<?php

declare(strict_types=1);

namespace FullDiagram;

class Configuration
{
    public function __construct(
        private readonly int  $ancestorGenerations = 3,
        private readonly int  $descendantGenerations = 3,
        private readonly bool $showSiblings = true,
    ) {
    }

    public function ancestorGenerations(): int
    {
        return $this->ancestorGenerations;
    }

    public function descendantGenerations(): int
    {
        return $this->descendantGenerations;
    }

    public function showSiblings(): bool
    {
        return $this->showSiblings;
    }
}
