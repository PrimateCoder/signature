<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Api;

use Flarum\Api\Context;
use Flarum\Api\Schema;
use Flarum\User\User;
use FoF\Signature\Formatter\SignatureFormatter;

class UserResourceFields
{
    public function __construct(
        protected SignatureFormatter $formatter
    ) {
    }

    public function __invoke(): array
    {
        return [
            Schema\Str::make('signature')
                ->get(fn (User $user, Context $context) => $user->signature ? $this->formatter->unparse($user->signature) : null)
                ->writable(fn (User $user, Context $context) => $context->getActor()->can('editSignature', $user))
                ->nullable(),

            Schema\Str::make('signatureHtml')
                ->get(fn (User $user, Context $context) => $user->signature ? $this->formatter->render($user->signature) : null),

            Schema\Boolean::make('canEditSignature')
                ->get(fn (User $user, Context $context) => $context->getActor()->can('editSignature', $user)),

            Schema\Boolean::make('canHaveSignature')
                ->get(fn (User $user, Context $context) => $user->hasPermission('haveSignature')),
        ];
    }
}
