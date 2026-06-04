<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Validator;

use Flarum\Foundation\AbstractValidator;
use Flarum\Locale\TranslatorInterface;
use Flarum\Settings\SettingsRepositoryInterface;
use FoF\Signature\Formatter\SignatureFormatter;
use Illuminate\Validation\Factory;
use Symfony\Component\DomCrawler\Crawler;

class SignatureValidator extends AbstractValidator
{
    public function __construct(
        Factory $validator,
        TranslatorInterface $translator,
        protected SettingsRepositoryInterface $settings,
        protected SignatureFormatter $formatter
    ) {
        parent::__construct($validator, $translator);

        $this->validator->extend('signature_images', function ($attribute, $value, $parameters, $validator) {
            return $this->validateSignatureImages($value);
        });
    }

    protected function getRules(): array
    {
        return [
            'signature' => [
                'string',
                'max:'.$this->settings->get('signature.maximum_char_limit'),
                'signature_images',
            ],
        ];
    }

    private function validateSignatureImages($value): bool
    {
        $parsedContent = $this->formatter->parse($value);

        $crawler = new Crawler($parsedContent);
        $images = $crawler->filter('img');

        if ($images->count() > (int) $this->settings->get('signature.maximum_image_count')) {
            return false;
        }

        return true;
    }
}
